import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { GoogleAuth } from 'google-auth-library';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Dynamically resolve the target agent backend for Cloud Run, or Localhost
const AGENT_URL = process.env.AGENT_URL || 'http://localhost:10002';

console.log(`Starting BFF Server... Proxying to: ${AGENT_URL}`);

const auth = new GoogleAuth();

// Middleware to fetch a secure OIDC Identity token if targeting a protected Cloud Run Agent
const authMiddleware = async (req, res, next) => {
  if (AGENT_URL.includes('.run.app')) {
    try {
      const cleanAudience = AGENT_URL.replace(/\/$/, "").replace(/\/\*$/, "");
      const client = await auth.getIdTokenClient(cleanAudience);
      const token = await client.idTokenProvider.fetchIdToken(cleanAudience);
      
      if (token) {
        req.headers['authorization'] = `Bearer ${token}`;
      }
    } catch (err) {
      console.error(`[Auth-Error] Failed to fetch token: ${err.message}`);
    }
  }
  next();
};

// Securely proxy API traffic, converting standard authorization headers to Cloud Run's expected serverless header
app.use('/api', authMiddleware, createProxyMiddleware({
  target: AGENT_URL,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },
  on: {
    proxyReq: (proxyReq, req, res) => {
      if (req.headers['authorization']) {
        proxyReq.setHeader('X-Serverless-Authorization', req.headers['authorization']);
        proxyReq.removeHeader('authorization');
      }
    }
  }
}));

// Serve the static production React bundle
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback SPA routing to index.html for client-side navigation
app.use((req, res, next) => {
  if (req.method === 'GET') { res.sendFile(path.join(__dirname, 'dist', 'index.html')); } 
  else { next(); }
});

app.listen(PORT, () => { console.log(`BFF Server securely listening on port ${PORT}`); });