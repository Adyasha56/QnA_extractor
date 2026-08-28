"""
Tests for POST /localize/handwriting (Phase 7D benchmark endpoint).

All tests use synthetic in-memory PNG images. No real network access.
No disk writes.
"""

import base64
import io

import pytest
from PIL import Image, ImageDraw
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

_URL = "/localize/handwriting"


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _make_png(width: int, height: int, rects=None) -> bytes:
    """White PNG with optional dark rectangles (ink simulation)."""
    img = Image.new("RGB", (width, height), color=(255, 255, 255))
    if rects:
        draw = ImageDraw.Draw(img)
        for x, y, w, h in rects:
            draw.rectangle([x, y, x + w - 1, y + h - 1], fill=(10, 10, 10))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _b64(png_bytes: bytes) -> str:
    return base64.b64encode(png_bytes).decode()


def _post(image_b64: str, gemini_bbox: dict) -> dict:
    resp = client.post(_URL, json={"imageBase64": image_b64, "geminiBbox": gemini_bbox})
    return resp


# ─── Happy-path tests ─────────────────────────────────────────────────────────

class TestLocalizeHandwritingSuccess:
    def test_returns_200_for_valid_ink_region(self):
        png = _make_png(200, 200, rects=[(50, 50, 80, 40)])
        resp = _post(_b64(png), {"x": 20, "y": 20, "width": 160, "height": 160})
        assert resp.status_code == 200

    def test_response_has_required_fields(self):
        png = _make_png(200, 200, rects=[(50, 50, 80, 40)])
        data = _post(_b64(png), {"x": 0, "y": 0, "width": 200, "height": 200}).json()
        assert "geminiBbox" in data
        assert "localizedBbox" in data
        assert "confidence" in data
        assert "diagnostics" in data
        assert "imageWidth" in data
        assert "imageHeight" in data

    def test_image_dimensions_returned_correctly(self):
        png = _make_png(300, 400)
        data = _post(_b64(png), {"x": 0, "y": 0, "width": 300, "height": 400}).json()
        assert data["imageWidth"] == 300
        assert data["imageHeight"] == 400

    def test_gemini_bbox_echoed_unchanged(self):
        png = _make_png(200, 200, rects=[(50, 50, 60, 60)])
        bbox = {"x": 10, "y": 10, "width": 180, "height": 180}
        data = _post(_b64(png), bbox).json()
        assert data["geminiBbox"] == bbox

    def test_localized_bbox_is_dict_when_ink_found(self):
        png = _make_png(200, 200, rects=[(50, 50, 60, 60)])
        data = _post(_b64(png), {"x": 0, "y": 0, "width": 200, "height": 200}).json()
        lb = data["localizedBbox"]
        assert isinstance(lb, dict)
        assert set(lb.keys()) == {"x", "y", "width", "height"}

    def test_localized_bbox_within_gemini_window(self):
        png = _make_png(200, 200, rects=[(60, 70, 50, 40)])
        gemini = {"x": 40, "y": 50, "width": 120, "height": 100}
        data = _post(_b64(png), gemini).json()
        lb = data["localizedBbox"]
        assert lb["x"] >= gemini["x"]
        assert lb["y"] >= gemini["y"]
        assert lb["x"] + lb["width"] <= gemini["x"] + gemini["width"]
        assert lb["y"] + lb["height"] <= gemini["y"] + gemini["height"]

    def test_confidence_is_float_between_0_and_1(self):
        png = _make_png(200, 200, rects=[(50, 50, 60, 60)])
        data = _post(_b64(png), {"x": 0, "y": 0, "width": 200, "height": 200}).json()
        c = data["confidence"]
        assert isinstance(c, float)
        assert 0.0 <= c <= 1.0

    def test_diagnostics_structure(self):
        png = _make_png(200, 200, rects=[(50, 50, 60, 60)])
        data = _post(_b64(png), {"x": 0, "y": 0, "width": 200, "height": 200}).json()
        d = data["diagnostics"]
        assert "component_count" in d
        assert "foreground_pixel_ratio" in d
        assert "crop_width" in d
        assert "crop_height" in d

    def test_diagnostics_component_count_positive_for_ink(self):
        png = _make_png(200, 200, rects=[(50, 50, 60, 60)])
        data = _post(_b64(png), {"x": 0, "y": 0, "width": 200, "height": 200}).json()
        assert data["diagnostics"]["component_count"] >= 1

    def test_diagnostics_crop_dimensions_match_bbox(self):
        png = _make_png(300, 300, rects=[(100, 100, 50, 50)])
        data = _post(_b64(png), {"x": 50, "y": 50, "width": 200, "height": 150}).json()
        assert data["diagnostics"]["crop_width"] == 200
        assert data["diagnostics"]["crop_height"] == 150


# ─── Blank / no-ink tests ─────────────────────────────────────────────────────

class TestLocalizeHandwritingBlank:
    def test_localized_bbox_null_for_blank_image(self):
        png = _make_png(200, 200)
        data = _post(_b64(png), {"x": 0, "y": 0, "width": 200, "height": 200}).json()
        assert data["localizedBbox"] is None

    def test_confidence_low_for_blank_image(self):
        png = _make_png(200, 200)
        data = _post(_b64(png), {"x": 0, "y": 0, "width": 200, "height": 200}).json()
        assert data["confidence"] < 0.05

    def test_component_count_zero_for_blank_image(self):
        png = _make_png(200, 200)
        data = _post(_b64(png), {"x": 0, "y": 0, "width": 200, "height": 200}).json()
        assert data["diagnostics"]["component_count"] == 0

    def test_returns_200_for_blank_image(self):
        png = _make_png(200, 200)
        resp = _post(_b64(png), {"x": 0, "y": 0, "width": 200, "height": 200})
        assert resp.status_code == 200


# ─── Clamping tests ───────────────────────────────────────────────────────────

class TestLocalizeHandwritingClamping:
    def test_overshooting_bbox_is_clamped_not_errored(self):
        png = _make_png(200, 200, rects=[(50, 50, 60, 60)])
        resp = _post(_b64(png), {"x": 150, "y": 150, "width": 200, "height": 200})
        assert resp.status_code == 200

    def test_entirely_out_of_bounds_bbox_returns_null_localized(self):
        png = _make_png(200, 200)
        data = _post(_b64(png), {"x": 300, "y": 300, "width": 50, "height": 50}).json()
        assert data["localizedBbox"] is None

    def test_negative_origin_bbox_is_clamped(self):
        png = _make_png(200, 200, rects=[(10, 10, 50, 50)])
        resp = _post(_b64(png), {"x": -20, "y": -20, "width": 100, "height": 100})
        assert resp.status_code == 200

    def test_gemini_bbox_still_echoed_when_clamped(self):
        png = _make_png(200, 200)
        bbox = {"x": 300, "y": 300, "width": 50, "height": 50}
        data = _post(_b64(png), bbox).json()
        assert data["geminiBbox"] == bbox


# ─── Error handling tests ─────────────────────────────────────────────────────

class TestLocalizeHandwritingErrors:
    def test_invalid_base64_returns_400(self):
        resp = _post("not-valid-base64!!!", {"x": 0, "y": 0, "width": 100, "height": 100})
        assert resp.status_code == 400

    def test_non_image_base64_returns_400(self):
        junk = base64.b64encode(b"this is not an image at all").decode()
        resp = _post(junk, {"x": 0, "y": 0, "width": 100, "height": 100})
        assert resp.status_code == 400

    def test_missing_image_base64_returns_422(self):
        resp = client.post(_URL, json={"geminiBbox": {"x": 0, "y": 0, "width": 10, "height": 10}})
        assert resp.status_code == 422

    def test_missing_gemini_bbox_returns_422(self):
        png = _make_png(100, 100)
        resp = client.post(_URL, json={"imageBase64": _b64(png)})
        assert resp.status_code == 422

    def test_empty_body_returns_422(self):
        resp = client.post(_URL, json={})
        assert resp.status_code == 422


# ─── No PDF coordinates test ──────────────────────────────────────────────────

class TestNoPdfCoordinates:
    def test_response_has_no_pdf_fields(self):
        png = _make_png(200, 200, rects=[(50, 50, 60, 60)])
        data = _post(_b64(png), {"x": 0, "y": 0, "width": 200, "height": 200}).json()
        assert "pdfBbox" not in data
        assert "pdfWidth" not in data
        assert "pdfHeight" not in data
        assert "pdfX" not in data
        assert "pdfY" not in data

    def test_localized_bbox_has_no_pdf_fields(self):
        png = _make_png(200, 200, rects=[(50, 50, 60, 60)])
        data = _post(_b64(png), {"x": 0, "y": 0, "width": 200, "height": 200}).json()
        lb = data["localizedBbox"]
        assert lb is not None
        for key in lb:
            assert "pdf" not in key.lower()
