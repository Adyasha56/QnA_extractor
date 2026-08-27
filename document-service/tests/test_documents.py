"""
Tests for document processing.

All HTTP calls are mocked with respx. No real network access occurs.
OCR is provided by a mock OcrProvider. No Tesseract binary is required.
"""
import pytest
import respx
import httpx
from fastapi.testclient import TestClient

from app.main import app
from app.routes.documents import get_ocr_provider
from app.processors.pdf_processor import extract_pages_from_pdf
from app.processors.image_processor import extract_from_image
from tests.conftest import make_mock_ocr

_FAKE_URL = "http://fake-storage.example.com/document"

client = TestClient(app)


# ─── Processor-level unit tests (no HTTP, no FastAPI) ───────────────────────

class TestPdfProcessor:
    def test_single_page_count(self, single_page_pdf_bytes):
        pages = extract_pages_from_pdf(single_page_pdf_bytes)
        assert len(pages) == 1

    def test_two_page_count(self, two_page_pdf_bytes):
        pages = extract_pages_from_pdf(two_page_pdf_bytes)
        assert len(pages) == 2

    def test_page_number_starts_at_one(self, single_page_pdf_bytes):
        pages = extract_pages_from_pdf(single_page_pdf_bytes)
        assert pages[0].pageNumber == 1

    def test_two_page_numbers_are_sequential(self, two_page_pdf_bytes):
        pages = extract_pages_from_pdf(two_page_pdf_bytes)
        assert pages[0].pageNumber == 1
        assert pages[1].pageNumber == 2

    def test_page_dimensions_are_a4(self, single_page_pdf_bytes):
        pages = extract_pages_from_pdf(single_page_pdf_bytes)
        # PyMuPDF reports A4 as 595 × 842 points
        assert pages[0].width == pytest.approx(595, abs=1)
        assert pages[0].height == pytest.approx(842, abs=1)

    def test_elements_are_extracted(self, single_page_pdf_bytes):
        pages = extract_pages_from_pdf(single_page_pdf_bytes)
        assert len(pages[0].elements) > 0

    def test_element_has_text(self, single_page_pdf_bytes):
        pages = extract_pages_from_pdf(single_page_pdf_bytes)
        for el in pages[0].elements:
            assert isinstance(el.text, str)
            assert len(el.text) > 0

    def test_element_bbox_structure(self, single_page_pdf_bytes):
        pages = extract_pages_from_pdf(single_page_pdf_bytes)
        bbox = pages[0].elements[0].bbox
        assert hasattr(bbox, "x")
        assert hasattr(bbox, "y")
        assert hasattr(bbox, "width")
        assert hasattr(bbox, "height")

    def test_element_bbox_values_are_numeric(self, single_page_pdf_bytes):
        pages = extract_pages_from_pdf(single_page_pdf_bytes)
        bbox = pages[0].elements[0].bbox
        for field in (bbox.x, bbox.y, bbox.width, bbox.height):
            assert isinstance(field, (int, float))

    def test_element_bbox_width_positive(self, single_page_pdf_bytes):
        pages = extract_pages_from_pdf(single_page_pdf_bytes)
        for el in pages[0].elements:
            assert el.bbox.width > 0
            assert el.bbox.height > 0

    def test_known_text_is_present(self, single_page_pdf_bytes):
        pages = extract_pages_from_pdf(single_page_pdf_bytes)
        all_text = " ".join(el.text for el in pages[0].elements)
        assert "Question" in all_text

    def test_blank_page_returns_empty_elements(self, blank_page_pdf_bytes):
        pages = extract_pages_from_pdf(blank_page_pdf_bytes)
        assert pages[0].elements == []

    def test_corrupt_pdf_raises_value_error(self):
        with pytest.raises(ValueError, match="Cannot open PDF"):
            extract_pages_from_pdf(b"this is not a pdf")

    def test_empty_pdf_raises_value_error(self):
        from unittest.mock import patch, MagicMock
        # PyMuPDF cannot serialize a zero-page document, so we mock fitz.open.
        mock_doc = MagicMock()
        mock_doc.__len__ = lambda _self: 0
        mock_doc.__iter__ = lambda _self: iter([])
        with patch("app.processors.pdf_processor.fitz.open", return_value=mock_doc):
            with pytest.raises(ValueError, match="no pages"):
                extract_pages_from_pdf(b"anything")

    def test_scanned_page_uses_ocr_provider(self, blank_page_pdf_bytes, mock_ocr):
        """A blank page (no selectable text) falls back to the OCR provider."""
        pages = extract_pages_from_pdf(blank_page_pdf_bytes, ocr_provider=mock_ocr)
        mock_ocr.extract.assert_called_once()
        assert len(pages[0].elements) > 0


class TestImageProcessor:
    def test_returns_one_page(self, sample_png_bytes, mock_ocr):
        pages = extract_from_image(sample_png_bytes, mock_ocr)
        assert len(pages) == 1

    def test_page_number_is_one(self, sample_png_bytes, mock_ocr):
        pages = extract_from_image(sample_png_bytes, mock_ocr)
        assert pages[0].pageNumber == 1

    def test_page_dimensions_match_image(self, sample_png_bytes, mock_ocr):
        pages = extract_from_image(sample_png_bytes, mock_ocr)
        assert pages[0].width == pytest.approx(400)
        assert pages[0].height == pytest.approx(200)

    def test_ocr_provider_is_called(self, sample_png_bytes, mock_ocr):
        extract_from_image(sample_png_bytes, mock_ocr)
        mock_ocr.extract.assert_called_once()

    def test_element_structure_from_mock_ocr(self, sample_png_bytes, mock_ocr):
        pages = extract_from_image(sample_png_bytes, mock_ocr)
        el = pages[0].elements[0]
        assert el.text == "Answer: Paris"
        assert el.bbox.x == pytest.approx(10.0)
        assert el.bbox.y == pytest.approx(10.0)
        assert el.bbox.width == pytest.approx(120.0)
        assert el.bbox.height == pytest.approx(18.0)

    def test_corrupt_image_raises_value_error(self, mock_ocr):
        with pytest.raises(ValueError, match="Cannot open image"):
            extract_from_image(b"not an image", mock_ocr)


# ─── FastAPI endpoint tests (HTTP-level with mocked downloads) ───────────────

@pytest.fixture(autouse=True)
def override_ocr_dependency(mock_ocr):
    """Replace the real Tesseract provider with the mock for all API tests."""
    app.dependency_overrides[get_ocr_provider] = lambda: mock_ocr
    yield
    app.dependency_overrides.clear()


class TestProcessEndpoint:
    @respx.mock
    def test_process_pdf_returns_200(self, single_page_pdf_bytes):
        respx.get(_FAKE_URL).mock(
            return_value=httpx.Response(
                200,
                content=single_page_pdf_bytes,
                headers={"content-type": "application/pdf"},
            )
        )
        res = client.post("/process", json={"url": _FAKE_URL})
        assert res.status_code == 200

    @respx.mock
    def test_process_pdf_response_has_pages(self, single_page_pdf_bytes):
        respx.get(_FAKE_URL).mock(
            return_value=httpx.Response(
                200,
                content=single_page_pdf_bytes,
                headers={"content-type": "application/pdf"},
            )
        )
        body = client.post("/process", json={"url": _FAKE_URL}).json()
        assert "pages" in body
        assert isinstance(body["pages"], list)
        assert len(body["pages"]) == 1

    @respx.mock
    def test_process_pdf_page_shape(self, single_page_pdf_bytes):
        respx.get(_FAKE_URL).mock(
            return_value=httpx.Response(
                200,
                content=single_page_pdf_bytes,
                headers={"content-type": "application/pdf"},
            )
        )
        page = client.post("/process", json={"url": _FAKE_URL}).json()["pages"][0]
        assert "pageNumber" in page
        assert "width" in page
        assert "height" in page
        assert "elements" in page

    @respx.mock
    def test_process_pdf_element_shape(self, single_page_pdf_bytes):
        respx.get(_FAKE_URL).mock(
            return_value=httpx.Response(
                200,
                content=single_page_pdf_bytes,
                headers={"content-type": "application/pdf"},
            )
        )
        page = client.post("/process", json={"url": _FAKE_URL}).json()["pages"][0]
        assert len(page["elements"]) > 0
        el = page["elements"][0]
        assert "text" in el
        assert "bbox" in el
        bbox = el["bbox"]
        for field in ("x", "y", "width", "height"):
            assert field in bbox

    @respx.mock
    def test_process_image_returns_200(self, sample_png_bytes):
        respx.get(_FAKE_URL).mock(
            return_value=httpx.Response(
                200,
                content=sample_png_bytes,
                headers={"content-type": "image/png"},
            )
        )
        res = client.post("/process", json={"url": _FAKE_URL})
        assert res.status_code == 200

    @respx.mock
    def test_process_image_page_count_is_one(self, sample_png_bytes):
        respx.get(_FAKE_URL).mock(
            return_value=httpx.Response(
                200,
                content=sample_png_bytes,
                headers={"content-type": "image/png"},
            )
        )
        body = client.post("/process", json={"url": _FAKE_URL}).json()
        assert len(body["pages"]) == 1

    @respx.mock
    def test_process_two_page_pdf_returns_two_pages(self, two_page_pdf_bytes):
        respx.get(_FAKE_URL).mock(
            return_value=httpx.Response(
                200,
                content=two_page_pdf_bytes,
                headers={"content-type": "application/pdf"},
            )
        )
        body = client.post("/process", json={"url": _FAKE_URL}).json()
        assert len(body["pages"]) == 2
        assert body["pages"][0]["pageNumber"] == 1
        assert body["pages"][1]["pageNumber"] == 2

    @respx.mock
    def test_download_failure_returns_400(self):
        respx.get(_FAKE_URL).mock(
            return_value=httpx.Response(404)
        )
        res = client.post("/process", json={"url": _FAKE_URL})
        assert res.status_code == 400

    @respx.mock
    def test_unsupported_content_type_returns_400(self):
        respx.get(_FAKE_URL).mock(
            return_value=httpx.Response(
                200,
                content=b"plain text data",
                headers={"content-type": "text/plain"},
            )
        )
        res = client.post("/process", json={"url": _FAKE_URL})
        assert res.status_code == 400

    def test_invalid_url_returns_422(self):
        res = client.post("/process", json={"url": "not-a-url"})
        assert res.status_code == 422

    def test_missing_url_returns_422(self):
        res = client.post("/process", json={})
        assert res.status_code == 422

    @respx.mock
    def test_corrupt_pdf_returns_400(self):
        respx.get(_FAKE_URL).mock(
            return_value=httpx.Response(
                200,
                content=b"corrupted pdf bytes",
                headers={"content-type": "application/pdf"},
            )
        )
        res = client.post("/process", json={"url": _FAKE_URL})
        assert res.status_code == 400

    @respx.mock
    def test_url_extension_fallback_for_pdf(self, single_page_pdf_bytes):
        """Falls back to URL extension when content-type is application/octet-stream."""
        url = "http://fake-storage.example.com/paper.pdf"
        respx.get(url).mock(
            return_value=httpx.Response(
                200,
                content=single_page_pdf_bytes,
                headers={"content-type": "application/octet-stream"},
            )
        )
        res = client.post("/process", json={"url": url})
        assert res.status_code == 200

    @respx.mock
    def test_document_type_field_is_accepted(self, single_page_pdf_bytes):
        respx.get(_FAKE_URL).mock(
            return_value=httpx.Response(
                200,
                content=single_page_pdf_bytes,
                headers={"content-type": "application/pdf"},
            )
        )
        res = client.post(
            "/process",
            json={"url": _FAKE_URL, "documentType": "question_paper"},
        )
        assert res.status_code == 200
