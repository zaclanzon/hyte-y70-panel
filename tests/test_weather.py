from hyte_panel.collectors.weather import build_url, describe, parse_forecast
from hyte_panel.config import WeatherConfig


def test_build_url_units():
    cfg = WeatherConfig(latitude=1.5, longitude=-2.25, units="imperial")
    url = build_url(cfg)
    assert "latitude=1.5" in url and "longitude=-2.25" in url
    assert "temperature_unit=fahrenheit" in url
    assert "fahrenheit" not in build_url(WeatherConfig())


def test_describe_codes():
    assert describe(0) == ("Clear sky", "sun")
    assert describe(95)[1] == "storm"
    assert describe(None) == ("Unknown", "cloud")
    assert describe(12345) == ("Unknown", "cloud")


def test_parse_forecast():
    data = {
        "current": {"temperature_2m": 21.4, "relative_humidity_2m": 55, "apparent_temperature": 20.1, "weather_code": 2, "wind_speed_10m": 12.3},
        "daily": {"time": ["2026-09-01", "2026-09-02"], "weather_code": [61, 0], "temperature_2m_max": [22, 25], "temperature_2m_min": [12, 13]},
    }
    w = parse_forecast(data, WeatherConfig(label="Home"))
    assert w["ok"] and w["label"] == "Home"
    assert w["description"] == "Partly cloudy" and w["icon"] == "cloud-sun"
    assert len(w["daily"]) == 2
    assert w["daily"][0]["icon"] == "rain" and w["daily"][1]["max"] == 25
