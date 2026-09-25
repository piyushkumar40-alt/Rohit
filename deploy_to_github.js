// deploy_to_github.js
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.argv[2];
if (!GITHUB_TOKEN) {
  console.error("ERROR: GitHub token not provided. Pass it as an argument or set GITHUB_TOKEN environment variable.");
  process.exit(1);
}
const OWNER = 'piyushkumar40-alt';
const REPO = 'Rohit';
const BRANCH = 'main';

// Files to deploy
const FILES_TO_DEPLOY = [
  'README.md',
  '.gitignore',
  'package.json',
  'start.bat',
  'src/db.js',
  'src/server.js',
  'src/seed.js',
  'public/index.html',
  'public/styles.css',
  'public/app.js',
  'public/vendor/qrcode.js',
  'data/sample_flipkart_returns.csv',
  'test/test_db.js',
  'test/test_api.js',
  'deploy_to_github.js'
];

function githubRequest(endpoint, method, payload = null) {
  return new Promise((resolve, reject) => {
    const postData = payload ? JSON.stringify(payload) : null;
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: endpoint,
      method: method,
      headers: {
        'User-Agent': 'Rohit-Deployer',
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      }
    };

    if (postData) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (e) {}
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data: json });
        } else {
          reject(new Error(`GitHub API Error [${res.statusCode}] on ${method} ${endpoint}: ${json ? json.message : body}`));
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function getFileSha(filePath) {
  try {
    const res = await githubRequest(`/repos/${OWNER}/${REPO}/contents/${filePath}?ref=${BRANCH}`, 'GET');
    return res.data ? res.data.sha : null;
  } catch (err) {
    // 404 means file doesn't exist yet
    return null;
  }
}

async function uploadFile(relPath) {
  const fullPath = path.join(__dirname, relPath);
  if (!fs.existsSync(fullPath)) {
    console.warn(`File ${relPath} not found, skipping.`);
    return;
  }

  const fileContent = fs.readFileSync(fullPath);
  const base64Content = fileContent.toString('base64');
  const existingSha = await getFileSha(relPath);

  const payload = {
    message: existingSha ? `Update ${relPath}` : `Add ${relPath}`,
    content: base64Content,
    branch: BRANCH
  };
  if (existingSha) {
    payload.sha = existingSha;
  }

  console.log(`Uploading ${relPath}...`);
  await githubRequest(`/repos/${OWNER}/${REPO}/contents/${relPath}`, 'PUT', payload);
  console.log(`✓ ${relPath} deployed successfully.`);
}

async function run() {
  console.log(`\n======================================================`);
  console.log(` Deploying Rohit Flipkart Returns Tracker to GitHub`);
  console.log(` Repository: https://github.com/${OWNER}/${REPO}`);
  console.log(` Branch:     ${BRANCH}`);
  console.log(`======================================================\n`);

  for (const file of FILES_TO_DEPLOY) {
    try {
      await uploadFile(file);
    } catch (err) {
      console.error(`❌ Failed to deploy ${file}:`, err.message);
    }
  }

  console.log(`\n🎉 Deployment Complete!`);
  console.log(`Repository URL: https://github.com/${OWNER}/${REPO}`);
}

run();
