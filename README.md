# VedaAI — QnA Extractor

An AI-powered tool for teachers that extracts questions from exam papers, matches them against handwritten student answers, and produces a structured mapping with bounding-box highlights.

## Live Demo

| Service | URL |
|---|---|
| **Frontend** | https://frontend-beta-two-61.vercel.app |
| **Backend** | https://qna-backend-ztcj.onrender.com |
| **Document Service** | https://qna-document-service.onrender.com |

---

## Architecture

```
┌─────────────────┐     REST API      ┌──────────────────────┐     HTTP      ┌────────────────────────┐
│  Next.js 15     │ ───────────────▶ │  Express (Node.js)   │ ────────────▶ │  FastAPI (Python)      │
│  Frontend       │                  │  Backend             │               │  Document Service      │
│  (Vercel)       │ ◀─────────────── │  (Render)            │ ◀──────────── │  (Render / Docker)     │
└─────────────────┘                  └──────────┬───────────┘               └────────────────────────┘
                                                │                                      │
                                    ┌───────────▼────────┐              ┌──────────────▼─────────────┐
                                    │  Cloudinary        │              │  Tesseract OCR             │
                                    │  (file storage)    │              │  PyMuPDF + OpenCV          │
                                    └────────────────────┘              └────────────────────────────┘
                                                │
                                    ┌───────────▼────────┐
                                    │  Gemini API        │
                                    │  (AI extraction    │
                                    │   + localization)  │
                                    └────────────────────┘
```

### Services

| Service | Tech | Purpose |
|---|---|---|
| **Frontend** | Next.js 15, Tailwind CSS v4, shadcn/ui | Upload UI, processing status, results + answer highlighting |
| **Backend** | Express, TypeScript | Assessment lifecycle, Cloudinary uploads, pipeline orchestration |
| **Document Service** | FastAPI, PyMuPDF, Tesseract, OpenCV | PDF rendering, OCR, handwriting localization |

---

## Features

- Upload a **question paper** (PDF/image) and a **student answer sheet** (PDF/image)
- Automatically **extracts all questions** using OCR + Gemini AI
- **Detects and extracts handwritten answers** from the answer sheet
- **Maps each answer to its question** using label matching and AI fallback
- **Localizes answer regions** — draws bounding boxes over the exact answer on the scanned sheet
- Shows **answered / unanswered / unmatched** breakdown
- Processing status with live progress polling

---

## Local Development

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 18+ | For backend and frontend |
| Python | 3.11+ | For document service |
| Tesseract OCR | 5.x | [Install guide](https://github.com/UB-Mannheim/tesseract/wiki) |

### 1. Clone and install

```bash
git clone <your-repo-url>
cd qna-extractor
```

### 2. Document service

```bash
cd document-service
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create `document-service/.env`:

```env
# Windows
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
# Linux / macOS
# TESSERACT_CMD=/usr/bin/tesseract
```

```bash
uvicorn app.main:app --reload --port 8000
```

### 3. Backend

```bash
cd backend
npm install
```

Create `backend/.env` (copy from `.env.example`):

```env
PORT=3001
NODE_ENV=development
PYTHON_SERVICE_URL=http://localhost:8000

CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-2.0-flash

CORS_ORIGIN=http://localhost:3000
```

```bash
npm run dev
```

### 4. Frontend

```bash
cd frontend
npm install
```

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default `3001`) |
| `PYTHON_SERVICE_URL` | Yes | URL of the FastAPI document service |
| `CLOUDINARY_CLOUD_NAME` | Yes | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Yes | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Yes | Cloudinary API secret |
| `GEMINI_API_KEY` | No* | Falls back to deterministic extraction if absent (no bounding boxes) |
| `GEMINI_MODEL` | No | Gemini model ID (default `gemini-2.0-flash`) |
| `CORS_ORIGIN` | No | Allowed frontend origin (default `*`) |

### Document service (`document-service/.env`)

| Variable | Required | Description |
|---|---|---|
| `TESSERACT_CMD` | Yes | Absolute path to the `tesseract` binary |

### Frontend (`frontend/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | Base URL of the Express backend |

---

## API Overview

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/assessments` | Create a new assessment |
| `POST` | `/api/assessments/:id/question-paper` | Upload question paper (multipart) |
| `POST` | `/api/assessments/:id/answer-sheet` | Upload answer sheet (multipart) |
| `POST` | `/api/assessments/:id/process` | Start the extraction + mapping pipeline |
| `GET` | `/api/assessments/:id/status` | Poll processing status (`progress` 0–100) |
| `GET` | `/api/assessments/:id/result` | Fetch the final result |
| `GET` | `/api/health` | Health check |

---

## Deployment

Deploy in this order — each service depends on the URL of the one below it.

### 1. Python Document Service → Render (Docker)

- New Web Service → connect repo
- **Root directory:** `document-service`
- **Runtime:** Docker
- **Environment variables:**

```
TESSERACT_CMD=/usr/bin/tesseract
```

Note the deployed URL: `https://qna-document-service.onrender.com`

---

### 2. Backend → Render (Node)

- New Web Service → same repo
- **Root directory:** `backend`
- **Runtime:** Node
- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- **Environment variables:**

```
NODE_ENV=production
PYTHON_SERVICE_URL=https://qna-document-service.onrender.com
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.0-flash
CORS_ORIGIN=https://your-app.vercel.app    ← update after step 3
```

Note the deployed URL: `https://qna-backend.onrender.com`

---

### 3. Frontend → Vercel

- Import repo on Vercel → set **Root Directory** to `frontend`
- Framework auto-detected as Next.js
- **Environment variables:**

```
NEXT_PUBLIC_API_URL=https://qna-backend.onrender.com
```

Then go back to the backend Render service and update `CORS_ORIGIN` to the Vercel URL.

---

### Free tier note

Render free services spin down after 15 minutes of inactivity — the first request after idle takes ~30s to cold-start. Upgrade to Render Starter ($7/mo) for always-on services.

---

## Running Tests

```bash
# Backend
cd backend && npm test

# Document service
cd document-service && pytest
```

---

## Tech Stack

**Frontend:** Next.js 15, React 19, Tailwind CSS v4, shadcn/ui, Lucide React

**Backend:** Express 4, TypeScript, Multer, Cloudinary SDK, Google Generative AI SDK

**Document Service:** FastAPI, PyMuPDF, Tesseract OCR, OpenCV, Pillow, pytesseract
