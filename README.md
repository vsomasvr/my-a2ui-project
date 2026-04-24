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
    "a2ui-agent-sdk==0.1.1", 
]
```

### 2.2 Update Client Dependencies (`client/package.json`)

Open `client/package.json`. Change the `@a2ui/react` dependency to a published version, and add four new backend proxy frameworks that we'll use for our server-side security.

**Change `dependencies and devDependencies` blocks to:**
```json
  "dependencies": {
    "@a2a-js/sdk": "0.3.4",
    "@a2ui/react": "0.9.1",
    "react": "18.3.1",
    "react-dom": "18.3.1"
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
