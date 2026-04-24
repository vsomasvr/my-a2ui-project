# A2UI Secure Agent: Deploying A2UI to a Zero-Trust Cloud Run Environment

This tutorial provides exact, line-by-line instructions on how to take the raw Google A2UI repository's **Restaurant Finder Example** alongside the **React Client**, and transform them into a standalone, production-ready architecture designed for Google Cloud Run. 

### Architectural Overview

This project embodies a modern, Zero-Trust architectural pattern utilizing several interlocked building blocks:
- **AI Agent (A2A)**: A scalable, Python-based FastAPI backend powered by Vertex AI that natively structures and streams JSON-RPC data.
- **A2UI**: A dynamic React user interface designed specifically to render rich, agentic data streams from the backend.
- **Backend-For-Frontend (BFF)**: A lightweight Node.js Express server that serves the frontend React shell and securely routes API traffic.
- **Service-to-Service Security**: The BFF mints and injects OIDC identity tokens on-the-fly, allowing the backend Agent to reject any unauthenticated traffic and remain locked from the public internet.
- **Identity-Aware Proxy (IAP)**: A zero-login-code security wall deployed over the frontend Cloud Run service, ensuring only authorized Google accounts can load the application.

---

## Getting Started: Using this Repository

The following sections detail the exact steps taken to create this standalone architecture from the original A2UI monorepo examples. Review these steps to understand how the architecture was built, or to migrate your own custom A2UI examples.

## Step 1: Clone and Scaffold the Project
First, we will clone the source repository and carve out only the agent and client code we need into a new standalone folder.

```bash
# 1. Clone the upstream A2UI repository
git clone --depth 1 --branch v0.9 https://github.com/google/a2ui.git

# 2. Create your new standalone repository
mkdir my-a2ui-project
cd my-a2ui-project

# 3. Scaffold the subdirectories
mkdir agent client 

# 4. Copy the Restaurant Finder Agent
cp -r ../a2ui/samples/agent/adk/restaurant_finder/. ./agent/

# 5. Copy the React Client Shell
cp -r ../a2ui/samples/client/react/shell/. ./client/

# 6. copy the .gitignore and .geminiignore files
cp ../a2ui/.gitignore ../a2ui/.geminiignore .
```

You now have the baseline code. Now we must modify it to run independently and securely in the cloud.

---

## Step 2: Detaching Dependencies from the Monorepo
Both the Agent and the Client use local file linking (`file:...` and `path=...`) in their original state. We need to swap these to standard remote package registries (PyPI and NPM).

### 2.1 Update Agent Dependencies (`agent/pyproject.toml`)

Open `agent/pyproject.toml` in your editor. Find the dependencies array and update it:

**Change To:**
```toml
dependencies = [
    "a2a-sdk==0.3.26",
    "click==8.1.8",
    "google-adk==1.28.0",
    "google-genai==1.64.0", 
    "python-dotenv==1.1.0",
    "litellm==1.83.0",
    "jsonschema==4.23.0",
    "a2ui-agent-sdk==0.1.2", 
]
```

### 2.2 Update Client Dependencies (`client/package.json`)

Open `client/package.json`. Change the `@a2ui/react` dependency to a published version, and add four new backend proxy frameworks that we'll use for our server-side security.

**Change `dependencies and devDependencies` blocks to:**
```json
  "dependencies": {
    "@a2a-js/sdk": "0.3.13",
    "@a2ui/react": "0.8.0", 
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "express": "5.2.1",
    "google-auth-library": "10.6.2",
    "http-proxy-middleware": "3.0.5"
  },
  "devDependencies": {
    "@types/react": "18.3.27",
    "@types/react-dom": "18.3.7",
    "@vitejs/plugin-react": "4.7.0",
    "typescript": "5.9.3",
    "vite": "6.4.1"
  }
```

---
## Step 3: Vertex AI Integration
We need to modify the Python Agent to leverage Vertex AI (instead of just generic Gemini with API keys) 

### 3.1 Update the LLM Integration (`agent/agent.py`)

Open `agent/agent.py` and modify `build_llm_agent(self, ...)` to dynamically switch to Vertex AI when deployed:

**Find this line (around line 149):**
```python
    LITELLM_MODEL = os.getenv("LITELLM_MODEL", "gemini/gemini-2.5-flash")
```

**Replace it with:**
```python
    is_vertex = os.getenv("GOOGLE_GENAI_USE_VERTEXAI") == "TRUE"
    default_model = "vertex_ai/gemini-2.5-flash" if is_vertex else "gemini/gemini-2.5-flash"
    LITELLM_MODEL = os.getenv("LITELLM_MODEL", default_model)
```
---
### 4. Local Running and Testing
To develop both the React frontend and the AI Agent locally with hot-reloading:

1. **Configure Vertex AI Credentials:**
   The Python Agent needs to know your Google Cloud Project and region to access Vertex AI models. Create an `.env` file inside the `agent/` directory:
   
   ```bash
   # inside my-a2ui-project
   cp agent/.env.example agent/.env
   ```
   Now edit `agent/.env` to ensure Vertex AI is toggled on and your configuration is set:
   
   ```env
   GOOGLE_GENAI_USE_VERTEXAI=TRUE
   VERTEX_PROJECT=[GCP_PROJECT]
   VERTEX_LOCATION=us-central1
   ```

2. **Run the Developer Stack:**
   Authenticate your local terminal so the Agent has access to Vertex AI, then use the `concurrently` script we added to automatically launch both servers:
   
   ```bash
   gcloud auth application-default login
   ```

   ```bash
   # Start the React frontend
   cd client
   npm install
   npm run dev

   # In parallel, start the Python agent
   cd ../agent
   uv run python __main__.py
   ```

   *Your local React app will now be running on port 5003 and correctly routing api requests to your local Python Agent!*
---
## Step 5: Constructing the Security Proxy layer (BFF)
We never want to expose Identity Tokens to a user's browser. Therefore, we use a Backend-For-Frontend (BFF) that mints an OIDC token and attaches it to proxy requests sent from the React UI to the Cloud Run Agent.

1. **Update Client Dependencies (`client/package.json`):**

Open `client/package.json`. Change the `@a2ui/react` dependency to a published version, and add four new backend proxy frameworks that we'll use for our server-side security.

**Change `dependencies` block to:**
```json
  "dependencies": {
    "@a2a-js/sdk": "0.3.13",
    "@a2ui/react": "0.8.0", 
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "express": "5.2.1",
    "google-auth-library": "10.6.2",
    "http-proxy-middleware": "3.0.5"
  },
```

2. **Create a new file `client/server.js` and paste this exact implementation:**

```javascript
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
```

3.a **Define Vite Environment Types (TypeScript):**
Since we will rely on import.meta.env (in the next step) to configure VITE_AGENT_BASE_URL endpoint, TypeScript must understand the Vite environment.

Create a new file client/src/vite-env.d.ts and add exactly this line:

/// <reference types="vite/client" />

3.b **Update Client API endpoints `client/src/configs/restaurant.ts` and paste this exact implementation:**
 Open client/src/configs/restaurant.ts and modify the default server URL fallback to support Vite environments:

Update line around 56 from:
```ts
  serverUrl: 'http://localhost:10002',
```

To
```ts
  // Routes traffic through the BFF proxy to avoid CORS and securely handle identity tokens
  serverUrl: import.meta.env.VITE_CLIENT_FACING_AGENT_BASE_URL || 'http://localhost:10002', 
```


4. **Update Agent Base URL and CORS (agent/__main__.py):**
 Open agent/__main__.py.

 Update Line 51 from:

 ```py
 base_url = f"http://{host}:{port}"
 ```
 To

 ```py
 # Set the client-accessible URL for the Agent Card to ensure proper frontend routing through proxies.
  base_url = os.getenv("CLIENT_FACING_AGENT_BASE_URL", f"http://{host}:{port}")
  logger.info(f"Agent Card base URL: {base_url}")
  ```

  AND

  Relax the CORS regex to accept Cloud Run requests. 
  Change Line around 72 from:
  ```py
  allow_origin_regex=r"http://localhost:\d+",
  ```

  To 
  ```py
  allow_origin_regex=r"(http://localhost:\d+|https://.*\.run\.app)",
  ```

---

## Step 6: Local Execution Scenarios

Now that your architecture is fully set up, you have two different ways to run the project locally depending on what you are trying to test.

### Scenario A: Local Development (Fast UI Iteration)
This is the fastest way to develop with hot-reloading. The Vite development server runs the React UI, and it routes requests directly to the Python agent without any BFF proxy in the middle.

```bash
# Terminal 1: Start the Python agent
cd agent
uv run python __main__.py

# Terminal 2: Start the React frontend (Vite)
cd client
npm run dev
```
*Your React app is now running on port 5003 and talking directly to the agent on port 10002.*

### Scenario B: Production Simulation (BFF Proxy Validation)
This validates your Cloud Run architecture by bypassing Vite completely. You serve the built React UI directly through the Node.js BFF proxy, which securely intercepts and forwards `/api` traffic.

```bash
# Terminal 1: Start the Python agent with the BFF alias
# CLIENT_FACING_AGENT_BASE_URL: Tells the Python backend what public-facing URL path to put inside the Agent Card so the frontend knows
# how to route subsequent traffic.
cd agent
CLIENT_FACING_AGENT_BASE_URL=/api uv run python __main__.py

# Terminal 2: Build the React bundle and start the Node BFF
# VITE_CLIENT_FACING_AGENT_BASE_URL: Tells the React frontend exactly which URL path to use to fetch the Agent Card (e.g., /api).
cd client
npm run build
VITE_CLIENT_FACING_AGENT_BASE_URL=/api npm run start-bff
```
*Your UI is now running exactly as it will in production on port 8080!*