from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_returns_200():
    res = client.get("/health")
    assert res.status_code == 200


def test_health_body_has_status_ok():
    res = client.get("/health")
    assert res.json()["status"] == "ok"


def test_health_body_has_timestamp():
    res = client.get("/health")
    assert isinstance(res.json()["timestamp"], str)
    assert res.json()["timestamp"] != ""
