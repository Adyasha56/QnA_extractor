"""
Handwriting region localizer (Phase 7D).

Uses OpenCV to find the tightest bounding box around meaningful handwritten
content within a Gemini-provided coarse search window.

Algorithm
---------
1. Decode the full rendered page PNG from bytes.
2. Clamp the Gemini bbox to image bounds (Gemini may slightly overshoot).
3. Crop to the clamped region.
4. Convert the crop to grayscale.
5. Apply Otsu's adaptive threshold: ink (dark) → 255, background (light) → 0.
6. Remove speckle noise with a morphological opening (2×2 kernel).
7. Find external contours of foreground blobs.
8. Discard contours whose area is below min_contour_area (noise filtering).
9. Compute the union bounding box of all remaining contours.
10. Translate the union bbox back to page-image pixel coordinates.

Properties
----------
- Fully deterministic — no randomness, no AI, no OCR.
- Coordinates are always in the original page image's pixel coordinate system.
- The localized bbox is guaranteed to be contained within (or equal to) the
  clamped Gemini bbox; it is never fabricated when no foreground is detected.
- Does not assume fixed image dimensions or A4 paper size.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np

# ─── Data types ───────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class PixelBbox:
    """Bounding box in pixel coordinates (top-left origin, x right, y down)."""

    x: int
    y: int
    width: int
    height: int

    @property
    def area(self) -> int:
        return self.width * self.height

    def to_dict(self) -> dict:
        return {"x": self.x, "y": self.y, "width": self.width, "height": self.height}

    @staticmethod
    def from_dict(d: dict) -> "PixelBbox":
        """Accept int or float values from Gemini; truncate to int."""
        return PixelBbox(
            x=int(d["x"]),
            y=int(d["y"]),
            width=int(d["width"]),
            height=int(d["height"]),
        )


@dataclass
class LocalizationDiagnostics:
    """Intermediate values for debugging and algorithm tuning."""

    # Number of contours that survived the area filter.
    component_count: int
    # Ratio of cleaned foreground pixels to total crop area (0.0–1.0).
    # Indicates ink density; near-zero means blank or very light content.
    foreground_pixel_ratio: float
    # Actual crop dimensions used (may differ from gemini_bbox if clamped).
    crop_width: int
    crop_height: int


@dataclass
class LocalizationResult:
    """
    Result of one handwriting localization attempt.

    gemini_bbox:    Original Gemini search window — preserved, unmodified.
    localized_bbox: Tight bbox around detected ink in page pixel coordinates.
                    None when no meaningful foreground is detected (blank region,
                    all noise, or zero-area crop after clamping).
    confidence:     Foreground pixel density in the crop (0.0–1.0).
                    Reflects how much ink was found; not a classification score.
    diagnostics:    Intermediate values for debugging / threshold tuning.
    """

    gemini_bbox: PixelBbox
    localized_bbox: Optional[PixelBbox]
    confidence: float
    diagnostics: LocalizationDiagnostics


# ─── Algorithm constants ──────────────────────────────────────────────────────

# Contours with pixel area below this are treated as speckle noise.
# At 2× render scale (A4 ≈ 1190×1684 px) a single pen-stroke segment is
# typically 40-200 px²; isolated noise specks are 1-9 px².
_DEFAULT_MIN_CONTOUR_AREA: int = 20

# Morphological kernel for noise removal via opening (erosion then dilation).
# A 2×2 kernel removes single-pixel isolated specks while preserving thin strokes.
_NOISE_KERNEL: np.ndarray = np.ones((2, 2), np.uint8)


# ─── Public API ───────────────────────────────────────────────────────────────


def localize_handwriting(
    image_bytes: bytes,
    gemini_bbox: dict,
    image_width: int,
    image_height: int,
    min_contour_area: int = _DEFAULT_MIN_CONTOUR_AREA,
) -> LocalizationResult:
    """
    Find a tight bounding box around handwritten ink within a Gemini search window.

    Args:
        image_bytes:       Full rendered page PNG as raw bytes (in-memory, no path).
        gemini_bbox:       Gemini's coarse answer region {x, y, width, height}.
                           Values may be float; they are truncated to int.
        image_width:       Full page image width in pixels (used for clamping).
        image_height:      Full page image height in pixels (used for clamping).
        min_contour_area:  Contours with area < this value are treated as noise.

    Returns:
        LocalizationResult.  localized_bbox is None when no ink is detected.

    Raises:
        ValueError: If image_bytes cannot be decoded as an image by OpenCV.
    """
    gemini = PixelBbox.from_dict(gemini_bbox)
    img = _decode_image(image_bytes)

    # ── Step 1: Clamp crop to image bounds ────────────────────────────────────
    cx1 = max(0, gemini.x)
    cy1 = max(0, gemini.y)
    cx2 = min(image_width,  gemini.x + gemini.width)
    cy2 = min(image_height, gemini.y + gemini.height)
    crop_w = cx2 - cx1
    crop_h = cy2 - cy1

    empty_diag = LocalizationDiagnostics(
        component_count=0,
        foreground_pixel_ratio=0.0,
        crop_width=crop_w,
        crop_height=crop_h,
    )

    if crop_w <= 0 or crop_h <= 0:
        return LocalizationResult(
            gemini_bbox=gemini,
            localized_bbox=None,
            confidence=0.0,
            diagnostics=empty_diag,
        )

    # ── Step 2: Grayscale ─────────────────────────────────────────────────────
    crop = img[cy1:cy2, cx1:cx2]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

    # ── Step 3: Otsu threshold — ink (dark) becomes 255, background → 0 ──────
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # ── Step 4: Remove speckle noise via morphological opening ────────────────
    cleaned = cv2.morphologyEx(binary, cv2.MORPH_OPEN, _NOISE_KERNEL)

    foreground_px = int(np.sum(cleaned > 0))
    crop_area = crop_w * crop_h
    pixel_ratio = foreground_px / crop_area if crop_area > 0 else 0.0

    # ── Step 5: Find external contours of foreground blobs ───────────────────
    contours, _ = cv2.findContours(cleaned, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # ── Step 6: Filter noise contours ─────────────────────────────────────────
    meaningful = [c for c in contours if cv2.contourArea(c) >= min_contour_area]

    diag = LocalizationDiagnostics(
        component_count=len(meaningful),
        foreground_pixel_ratio=pixel_ratio,
        crop_width=crop_w,
        crop_height=crop_h,
    )

    if not meaningful:
        return LocalizationResult(
            gemini_bbox=gemini,
            localized_bbox=None,
            confidence=pixel_ratio,
            diagnostics=diag,
        )

    # ── Step 7: Union bbox of all meaningful contours (crop-local coords) ─────
    rects = [cv2.boundingRect(c) for c in meaningful]
    lx = min(r[0] for r in rects)
    ly = min(r[1] for r in rects)
    rx = max(r[0] + r[2] for r in rects)
    ry = max(r[1] + r[3] for r in rects)

    # ── Step 8: Translate back to page-image pixel coordinates ────────────────
    localized = PixelBbox(
        x=cx1 + lx,
        y=cy1 + ly,
        width=rx - lx,
        height=ry - ly,
    )

    return LocalizationResult(
        gemini_bbox=gemini,
        localized_bbox=localized,
        confidence=pixel_ratio,
        diagnostics=diag,
    )


# ─── Internal helpers ─────────────────────────────────────────────────────────


def _decode_image(image_bytes: bytes) -> np.ndarray:
    if not image_bytes:
        raise ValueError("Cannot decode image bytes: empty input.")
    nparr = np.frombuffer(image_bytes, np.uint8)
    try:
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except cv2.error as exc:
        raise ValueError(f"Cannot decode image bytes: {exc}") from exc
    if img is None:
        raise ValueError("Cannot decode image bytes: not a valid image format.")
    return img
