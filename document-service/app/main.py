from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from app.routes.health import router as health_router
from app.routes.documents import router as documents_router
from app.routes.render import router as render_router
from app.routes.localize import router as localize_router

app = FastAPI(title="Document Processing Service", version="0.1.0")

app.include_router(health_router)
app.include_router(documents_router)
app.include_router(render_router)
app.include_router(localize_router)
