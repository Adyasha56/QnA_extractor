"""
Tests for the PDF page rendering capability (Phase 7B).

All HTTP calls are mocked with respx. No real network access occurs.
No Tesseract binary is required.
"""
import base64
import io
from unittest.mock import patch, MagicMock

import fitz
import httpx
import pytest
import respx
from PIL import Image
from fastapi.testclient import TestClient

from app.main import app
from app.processors.page_renderer import render_pdf_pages, DEFAULT_RENDER_SCALE

_FAKE_PDF_URL = "http://fake-storage.example.com/answer-sheet.pdf"
_FAKE_IMG_URL = "http://fake-storage.example.com/answer-sheet.png"

client = TestClient(app)


# ─── Processor-level unit tests ──────────────────────────────────────────────

class TestRenderPdfPages:

    def test_single_page_returns_one_entry(self, single_page_pdf_bytes):
        pages = render_pdf_pages(single_page_pdf_bytes)
        assert len(pages) == 1

    def test_single_page_number_is_one(self, single_page_pdf_bytes):
        pages = render_pdf_pages(single_page_pdf_bytes)
        assert pages[0].pageNumber == 1

    def test_multi_page_returns_correct_count(self, two_page_pdf_bytes):
        pages = render_pdf_pages(two_page_pdf_bytes)
        assert len(pages) == 2

    def test_multi_page_numbers_are_sequential(self, two_page_pdf_bytes):
        pages = render_pdf_pages(two_page_pdf_bytes)
        assert pages[0].pageNumber == 1
        assert pages[1].pageNumber == 2

    # ── Rendered dimensions are deterministic ─────────────────────────────────

    def test_image_width_is_scale_times_pdf_width(self, single_page_pdf_bytes):
        pages = render_pdf_pages(single_page_pdf_bytes)
        p = pages[0]
        expected = round(p.pdfWidth * DEFAULT_RENDER_SCALE)
        assert p.imageWidth == pytest.approx(expected, abs=1)

    def test_image_height_is_scale_times_pdf_height(self, single_page_pdf_bytes):
        pages = render_pdf_pages(single_page_pdf_bytes)
        p = pages[0]
        expected = round(p.pdfHeight * DEFAULT_RENDER_SCALE)
        assert p.imageHeight == pytest.approx(expected, abs=1)

    def test_explicit_scale_controls_image_dimensions(self, single_page_pdf_bytes):
        pages_2x = render_pdf_pages(single_page_pdf_bytes, scale=2.0)
        pages_3x = render_pdf_pages(single_page_pdf_bytes, scale=3.0)
        assert pages_3x[0].imageWidth > pages_2x[0].imageWidth
        assert pages_3x[0].imageHeight > pages_2x[0].imageHeight

    def test_same_pdf_produces_identical_dimensions_on_repeat_call(self, single_page_pdf_bytes):
        pages_a = render_pdf_pages(single_page_pdf_bytes)
        pages_b = render_pdf_pages(single_page_pdf_bytes)
        assert pages_a[0].imageWidth == pages_b[0].imageWidth
        assert pages_a[0].imageHeight == pages_b[0].imageHeight

    def test_a4_at_2x_has_expected_pixel_dimensions(self, single_page_pdf_bytes):
        # A4 = 595 × 842 PDF points → 2× → ~1190 × 1684 pixels
        pages = render_pdf_pages(single_page_pdf_bytes)
        assert pages[0].imageWidth == pytest.approx(1190, abs=2)
        assert pages[0].imageHeight == pytest.approx(1684, abs=2)

    # ── PDF dimensions are preserved ──────────────────────────────────────────

    def test_pdf_width_matches_page_rect(self, single_page_pdf_bytes):
        pages = render_pdf_pages(single_page_pdf_bytes)
        assert pages[0].pdfWidth == pytest.approx(595, abs=1)

    def test_pdf_height_matches_page_rect(self, single_page_pdf_bytes):
        pages = render_pdf_pages(single_page_pdf_bytes)
        assert pages[0].pdfHeight == pytest.approx(842, abs=1)

    def test_multi_page_each_page_preserves_pdf_dimensions(self, two_page_pdf_bytes):
        pages = render_pdf_pages(two_page_pdf_bytes)
        for p in pages:
            assert p.pdfWidth == pytest.approx(595, abs=1)
            assert p.pdfHeight == pytest.approx(842, abs=1)

    def test_scale_factors_are_consistent_across_axes(self, single_page_pdf_bytes):
        # For a square-pixel rendering, scale_x should equal scale_y.
        pages = render_pdf_pages(single_page_pdf_bytes)
        p = pages[0]
        scale_x = p.pdfWidth / p.imageWidth
        scale_y = p.pdfHeight / p.imageHeight
        assert scale_x == pytest.approx(scale_y, rel=0.01)

    # ── Rendered output is valid PNG ──────────────────────────────────────────

    def test_image_base64_is_non_empty(self, single_page_pdf_bytes):
        pages = render_pdf_pages(single_page_pdf_bytes)
        assert len(pages[0].imageBase64) > 0

    def test_image_base64_decodes_to_valid_png(self, single_page_pdf_bytes):
        pages = render_pdf_pages(single_page_pdf_bytes)
        raw = base64.b64decode(pages[0].imageBase64)
        img = Image.open(io.BytesIO(raw))
        assert img.format == "PNG"

    def test_png_dimensions_match_reported_image_size(self, single_page_pdf_bytes):
        pages = render_pdf_pages(single_page_pdf_bytes)
        p = pages[0]
        raw = base64.b64decode(p.imageBase64)
        img = Image.open(io.BytesIO(raw))
        assert img.width == p.imageWidth
        assert img.height == p.imageHeight

    def test_multi_page_each_image_is_valid_png(self, two_page_pdf_bytes):
        pages = render_pdf_pages(two_page_pdf_bytes)
        for p in pages:
            raw = base64.b64decode(p.imageBase64)
            img = Image.open(io.BytesIO(raw))
            assert img.format == "PNG"

    def test_pages_produce_distinct_images(self, two_page_pdf_bytes):
        # Each page has different text so the base64 strings must differ.
        pages = render_pdf_pages(two_page_pdf_bytes)
        assert pages[0].imageBase64 != pages[1].imageBase64

    # ── Error handling ────────────────────────────────────────────────────────

    def test_corrupt_pdf_raises_value_error(self):
        with pytest.raises(ValueError, match="Cannot open PDF"):
            render_pdf_pages(b"this is not a pdf")

    def test_empty_bytes_raises_value_error(self):
        with pytest.raises(ValueError, match="Cannot open PDF"):
            render_pdf_pages(b"")

    def test_zero_page_pdf_raises_value_error(self):
        mock_doc = MagicMock()
        mock_doc.__len__ = lambda _self: 0
        mock_doc.__iter__ = lambda _self: iter([])
        with patch("app.processors.page_renderer.fitz.open", return_value=mock_doc):
            with pytest.raises(ValueError, match="no pages"):
                render_pdf_pages(b"anything")


# ─── FastAPI endpoint tests ───────────────────────────────────────────────────

class TestRenderPagesEndpoint:

    @respx.mock
    def test_returns_200_for_valid_pdf(self, single_page_pdf_bytes):
        respx.get(_FAKE_PDF_URL).mock(
            return_value=httpx.Response(
                200,
                content=single_page_pdf_bytes,
                headers={"content-type": "application/pdf"},
            )
        )
        res = client.post("/render-pages", json={"url": _FAKE_PDF_URL})
        assert res.status_code == 200

    @respx.mock
    def test_response_has_pages_array(self, single_page_pdf_bytes):
        respx.get(_FAKE_PDF_URL).mock(
            return_value=httpx.Response(
                200,
                content=single_page_pdf_bytes,
                headers={"content-type": "application/pdf"},
            )
        )
        body = client.post("/render-pages", json={"url": _FAKE_PDF_URL}).json()
        assert "pages" in body
        assert isinstance(body["pages"], list)
        assert len(body["pages"]) == 1

    @respx.mock
    def test_response_page_has_all_required_fields(self, single_page_pdf_bytes):
        respx.get(_FAKE_PDF_URL).mock(
            return_value=httpx.Response(
                200,
                content=single_page_pdf_bytes,
                headers={"content-type": "application/pdf"},
            )
        )
        page = client.post("/render-pages", json={"url": _FAKE_PDF_URL}).json()["pages"][0]
        for field in ("pageNumber", "pdfWidth", "pdfHeight", "imageWidth", "imageHeight", "imageBase64"):
            assert field in page, f"Missing field: {field}"

    @respx.mock
    def test_two_page_pdf_returns_two_pages(self, two_page_pdf_bytes):
        respx.get(_FAKE_PDF_URL).mock(
            return_value=httpx.Response(
                200,
                content=two_page_pdf_bytes,
                headers={"content-type": "application/pdf"},
            )
        )
        body = client.post("/render-pages", json={"url": _FAKE_PDF_URL}).json()
        assert len(body["pages"]) == 2
        assert body["pages"][0]["pageNumber"] == 1
        assert body["pages"][1]["pageNumber"] == 2

    @respx.mock
    def test_image_url_returns_400(self, sample_png_bytes):
        respx.get(_FAKE_IMG_URL).mock(
            return_value=httpx.Response(
                200,
                content=sample_png_bytes,
                headers={"content-type": "image/png"},
            )
        )
        res = client.post("/render-pages", json={"url": _FAKE_IMG_URL})
        assert res.status_code == 400
        assert "PDF" in res.json()["detail"]

    @respx.mock
    def test_corrupt_pdf_returns_400(self):
        respx.get(_FAKE_PDF_URL).mock(
            return_value=httpx.Response(
                200,
                content=b"corrupted pdf bytes",
                headers={"content-type": "application/pdf"},
            )
        )
        res = client.post("/render-pages", json={"url": _FAKE_PDF_URL})
        assert res.status_code == 400

    @respx.mock
    def test_download_failure_returns_400(self):
        respx.get(_FAKE_PDF_URL).mock(
            return_value=httpx.Response(404)
        )
        res = client.post("/render-pages", json={"url": _FAKE_PDF_URL})
        assert res.status_code == 400

    def test_invalid_url_returns_422(self):
        res = client.post("/render-pages", json={"url": "not-a-url"})
        assert res.status_code == 422

    def test_missing_url_returns_422(self):
        res = client.post("/render-pages", json={})
        assert res.status_code == 422

    @respx.mock
    def test_response_image_base64_decodes_to_valid_png(self, single_page_pdf_bytes):
        respx.get(_FAKE_PDF_URL).mock(
            return_value=httpx.Response(
                200,
                content=single_page_pdf_bytes,
                headers={"content-type": "application/pdf"},
            )
        )
        page = client.post("/render-pages", json={"url": _FAKE_PDF_URL}).json()["pages"][0]
        raw = base64.b64decode(page["imageBase64"])
        img = Image.open(io.BytesIO(raw))
        assert img.format == "PNG"

    @respx.mock
    def test_response_pixel_dimensions_match_2x_scale(self, single_page_pdf_bytes):
        respx.get(_FAKE_PDF_URL).mock(
            return_value=httpx.Response(
                200,
                content=single_page_pdf_bytes,
                headers={"content-type": "application/pdf"},
            )
        )
        page = client.post("/render-pages", json={"url": _FAKE_PDF_URL}).json()["pages"][0]
        assert page["imageWidth"] == pytest.approx(page["pdfWidth"] * 2, abs=2)
        assert page["imageHeight"] == pytest.approx(page["pdfHeight"] * 2, abs=2)

    @respx.mock
    def test_existing_process_endpoint_still_works(self, single_page_pdf_bytes):
        """/process must be unaffected by the new route."""
        respx.get(_FAKE_PDF_URL).mock(
            return_value=httpx.Response(
                200,
                content=single_page_pdf_bytes,
                headers={"content-type": "application/pdf"},
            )
        )
        # Need OCR override since TestClient here is fresh (no autouse fixture).
        from app.routes.documents import get_ocr_provider
        from tests.conftest import make_mock_ocr
        app.dependency_overrides[get_ocr_provider] = lambda: make_mock_ocr()
        try:
            res = client.post("/process", json={"url": _FAKE_PDF_URL})
        finally:
            app.dependency_overrides.clear()
        assert res.status_code == 200
        assert "pages" in res.json()
