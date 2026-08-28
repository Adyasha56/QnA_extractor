"""
EXPERIMENTAL endpoint for benchmarking the Phase 7D handwriting localizer.

Do NOT use in production. Does not touch Answer.regions, Gemini extraction,
or any other part of the processing pipeline.
"""

import base64
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.processors.handwriting_localizer import localize_handwriting, PixelBbox

router = APIRouter(prefix="/localize", tags=["experimental"])


# ─── Request / response models ────────────────────────────────────────────────

class LocalizeRequest(BaseModel):
    imageBase64: str
    geminiBbox: dict  # {x, y, width, height}


class DiagnosticsOut(BaseModel):
    component_count: int
    foreground_pixel_ratio: float
    crop_width: int
    crop_height: int


class LocalizeResponse(BaseModel):
    geminiBbox: dict
    localizedBbox: Optional[dict]
    confidence: float
    diagnostics: DiagnosticsOut
    imageWidth: int
    imageHeight: int


# ─── Endpoint ─────────────────────────────────────────────────────────────────

@router.post("/handwriting", response_model=LocalizeResponse)
async def localize_handwriting_endpoint(request: LocalizeRequest) -> LocalizeResponse:
    """
    EXPERIMENTAL — Phase 7D benchmark only.

    Decodes the supplied PNG, runs the OpenCV handwriting localizer within the
    given Gemini bounding box, and returns the tight localized bbox along with
    confidence and diagnostics. No PDF coordinates are returned or computed.
    """
    try:
        image_bytes = base64.b64decode(request.imageBase64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid base64 image data: {exc}") from exc

    try:
        import cv2
        import numpy as np
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Could not decode image from base64 data.")
        image_height, image_width = img.shape[:2]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to read image dimensions: {exc}") from exc

    try:
        result = localize_handwriting(
            image_bytes=image_bytes,
            gemini_bbox=request.geminiBbox,
            image_width=image_width,
            image_height=image_height,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return LocalizeResponse(
        geminiBbox=result.gemini_bbox.to_dict(),
        localizedBbox=result.localized_bbox.to_dict() if result.localized_bbox else None,
        confidence=result.confidence,
        diagnostics=DiagnosticsOut(
            component_count=result.diagnostics.component_count,
            foreground_pixel_ratio=result.diagnostics.foreground_pixel_ratio,
            crop_width=result.diagnostics.crop_width,
            crop_height=result.diagnostics.crop_height,
        ),
        imageWidth=image_width,
        imageHeight=image_height,
    )
