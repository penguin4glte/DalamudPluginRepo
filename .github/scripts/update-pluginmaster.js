const fs = require('fs');
const path = require('path');

// GitHub API base URL
const GITHUB_API = 'https://api.github.com';

/**
 * Extract owner and repo name from GitHub URL
 * @param {string} repoUrl - GitHub repository URL
 * @returns {{owner: string, repo: string} | null}
 */
function parseRepoUrl(repoUrl) {
  if (!repoUrl) return null;

  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) return null;

  return {
    owner: match[1],
    repo: match[2]
  };
}

/**
 * Fetch all releases for a repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} token - GitHub token
 * @returns {Promise<Array>}
 */
async function fetchReleases(owner, repo, token) {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = `${GITHUB_API}/repos/${owner}/${repo}/releases`;

  try {
    const response = await fetch(url, { headers });

    if (!response.ok) {
      console.error(`Failed to fetch releases for ${owner}/${repo}: ${response.status} ${response.statusText}`);
      return [];
    }

    return await response.json();
  } catch (error) {
    console.error(`Error fetching releases for ${owner}/${repo}:`, error);
    return [];
  }
}

/**
 * Calculate total download count from all releases
 * @param {Array} releases - Array of release objects
 * @returns {number}
 */
function calculateDownloadCount(releases) {
  let totalDownloads = 0;

  for (const release of releases) {
    if (release.assets && Array.isArray(release.assets)) {
      for (const asset of release.assets) {
        totalDownloads += asset.download_count || 0;
      }
    }
  }

  return totalDownloads;
}

/**
 * Get the latest release notes (changelog) from releases
 * @param {Array} releases - Array of release objects
 * @returns {string}
 */
function getLatestChangelog(releases) {
  if (!releases || releases.length === 0) {
    return '';
  }

  // Find the latest release (releases are typically sorted by date, newest first)
  const latestRelease = releases[0];
  const changelog = latestRelease.body || '';

  // Convert line breaks to \r\n format
  return changelog.replace(/\r?\n/g, '\r\n');
}

/**
 * Get the download link from the latest release
 * @param {Array} releases - Array of release objects
 * @returns {string | null}
 */
function getLatestDownloadLink(releases) {
  if (!releases || releases.length === 0) {
    return null;
  }

  // Find the latest release (releases are typically sorted by date, newest first)
  const latestRelease = releases[0];

  if (!latestRelease.assets || latestRelease.assets.length === 0) {
    return null;
  }

  // Find the .zip asset (typically named 'latest.zip' for Dalamud plugins)
  const zipAsset = latestRelease.assets.find(asset =>
    asset.name.endsWith('.zip') && asset.browser_download_url
  );

  if (!zipAsset) {
    return null;
  }

  return zipAsset.browser_download_url;
}

/**
 * Get the version from the latest release
 * @param {Array} releases - Array of release objects
 * @returns {string | null}
 */
function getLatestVersion(releases) {
  if (!releases || releases.length === 0) {
    return null;
  }

  // Find the latest release (releases are typically sorted by date, newest first)
  const latestRelease = releases[0];

  if (!latestRelease.tag_name) {
    return null;
  }

  // Remove 'v' prefix if present (e.g., "v1.1.0" -> "1.1.0")
  let version = latestRelease.tag_name.replace(/^v/, '');

  // Ensure version has 4 parts for AssemblyVersion (e.g., "1.1.0" -> "1.1.0.0")
  const parts = version.split('.');
  while (parts.length < 4) {
    parts.push('0');
  }

  return parts.join('.');
}

/**
 * Main function to update download counts and changelogs
 */
async function main() {
  const token = process.env.GITHUB_TOKEN;
  const pluginmasterPath = path.join(process.cwd(), 'pluginmaster.json');

  // Read pluginmaster.json
  let plugins;
  try {
    const content = fs.readFileSync(pluginmasterPath, 'utf8');
    plugins = JSON.parse(content);
  } catch (error) {
    console.error('Error reading pluginmaster.json:', error);
    process.exit(1);
  }

  if (!Array.isArray(plugins)) {
    console.error('pluginmaster.json is not an array');
    process.exit(1);
  }

  console.log(`Processing ${plugins.length} plugin(s)...`);

  // Process each plugin
  for (const plugin of plugins) {
    const repoInfo = parseRepoUrl(plugin.RepoUrl);

    if (!repoInfo) {
      console.log(`Skipping ${plugin.Name || 'Unknown'}: Invalid RepoUrl`);
      continue;
    }

    console.log(`Fetching releases for ${repoInfo.owner}/${repoInfo.repo}...`);
    const releases = await fetchReleases(repoInfo.owner, repoInfo.repo, token);

    // Update DownloadCount
    const downloadCount = calculateDownloadCount(releases);
    plugin.DownloadCount = downloadCount;

    // Update Changelog with latest release notes
    const changelog = getLatestChangelog(releases);
    plugin.Changelog = changelog;

    // Update download links if latest release exists
    const latestDownloadLink = getLatestDownloadLink(releases);
    if (latestDownloadLink) {
      plugin.DownloadLinkInstall = latestDownloadLink;
      plugin.DownloadLinkUpdate = latestDownloadLink;
    }

    // Update AssemblyVersion from latest release
    const latestVersion = getLatestVersion(releases);
    if (latestVersion) {
      plugin.AssemblyVersion = latestVersion;
    }

    // Log update results
    if (latestDownloadLink && latestVersion) {
      console.log(`  ${plugin.Name}: ${downloadCount} downloads, version ${latestVersion}, changelog and download links updated`);
    } else if (latestDownloadLink) {
      console.log(`  ${plugin.Name}: ${downloadCount} downloads, changelog and download links updated (no version found)`);
    } else if (latestVersion) {
      console.log(`  ${plugin.Name}: ${downloadCount} downloads, version ${latestVersion}, changelog updated (no download link found)`);
    } else {
      console.log(`  ${plugin.Name}: ${downloadCount} downloads, changelog updated`);
    }
  }

  // Write updated pluginmaster.json
  try {
    const content = JSON.stringify(plugins, null, '\t');
    fs.writeFileSync(pluginmasterPath, content + '\n', 'utf8');
    console.log('\nSuccessfully updated pluginmaster.json');
  } catch (error) {
    console.error('Error writing pluginmaster.json:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
