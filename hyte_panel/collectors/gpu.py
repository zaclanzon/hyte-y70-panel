"""NVIDIA GPU readings. Uses NVML when available, else parses nvidia-smi."""

from __future__ import annotations

import shutil
import subprocess
from typing import Any

_FIELDS = [
    "name",
    "utilization.gpu",
    "temperature.gpu",
    "memory.used",
    "memory.total",
    "power.draw",
    "power.limit",
    "fan.speed",
    "clocks.sm",
    "clocks.mem",
]


def _num(value: str) -> float | None:
    value = value.strip()
    if not value or value.startswith("[") or value.lower() in ("n/a", "not supported"):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def parse_nvidia_smi(output: str) -> list[dict[str, Any]]:
    """Parse the CSV output of nvidia-smi --query-gpu with the _FIELDS order."""
    gpus = []
    for line in output.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < len(_FIELDS):
            continue
        mem_used = _num(parts[3])
        mem_total = _num(parts[4])
        gpus.append(
            {
                "name": parts[0],
                "util_percent": _num(parts[1]),
                "temp_c": _num(parts[2]),
                "mem_used_mb": mem_used,
                "mem_total_mb": mem_total,
                "mem_percent": (mem_used / mem_total * 100.0) if mem_used is not None and mem_total else None,
                "power_w": _num(parts[5]),
                "power_limit_w": _num(parts[6]),
                "fan_percent": _num(parts[7]),
                "clock_sm_mhz": _num(parts[8]),
                "clock_mem_mhz": _num(parts[9]),
            }
        )
    return gpus


class GpuCollector:
    def __init__(self, enabled: bool = True) -> None:
        self.enabled = enabled
        self._nvml = None
        self._smi = shutil.which("nvidia-smi")
        if enabled:
            self._init_nvml()

    def _init_nvml(self) -> None:
        try:
            import pynvml  # type: ignore

            pynvml.nvmlInit()
            self._nvml = pynvml
        except Exception:
            self._nvml = None

    def _via_nvml(self) -> list[dict[str, Any]]:
        nv = self._nvml
        gpus = []
        for i in range(nv.nvmlDeviceGetCount()):
            h = nv.nvmlDeviceGetHandleByIndex(i)
            name = nv.nvmlDeviceGetName(h)
            if isinstance(name, bytes):
                name = name.decode()
            util = nv.nvmlDeviceGetUtilizationRates(h)
            mem = nv.nvmlDeviceGetMemoryInfo(h)

            def safe(fn, *a):
                try:
                    return fn(*a)
                except Exception:
                    return None

            temp = safe(nv.nvmlDeviceGetTemperature, h, nv.NVML_TEMPERATURE_GPU)
            power = safe(nv.nvmlDeviceGetPowerUsage, h)
            limit = safe(nv.nvmlDeviceGetEnforcedPowerLimit, h)
            fan = safe(nv.nvmlDeviceGetFanSpeed, h)
            sm = safe(nv.nvmlDeviceGetClockInfo, h, nv.NVML_CLOCK_SM)
            memclk = safe(nv.nvmlDeviceGetClockInfo, h, nv.NVML_CLOCK_MEM)
            gpus.append(
                {
                    "name": name,
                    "util_percent": float(util.gpu),
                    "temp_c": float(temp) if temp is not None else None,
                    "mem_used_mb": mem.used / 1024 / 1024,
                    "mem_total_mb": mem.total / 1024 / 1024,
                    "mem_percent": mem.used / mem.total * 100.0 if mem.total else None,
                    "power_w": power / 1000.0 if power is not None else None,
                    "power_limit_w": limit / 1000.0 if limit is not None else None,
                    "fan_percent": float(fan) if fan is not None else None,
                    "clock_sm_mhz": float(sm) if sm is not None else None,
                    "clock_mem_mhz": float(memclk) if memclk is not None else None,
                }
            )
        return gpus

    def _via_smi(self) -> list[dict[str, Any]]:
        if not self._smi:
            return []
        try:
            out = subprocess.run(
                [self._smi, f"--query-gpu={','.join(_FIELDS)}", "--format=csv,noheader,nounits"],
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            return []
        if out.returncode != 0:
            return []
        return parse_nvidia_smi(out.stdout)

    def snapshot(self) -> list[dict[str, Any]]:
        if not self.enabled:
            return []
        if self._nvml is not None:
            try:
                return self._via_nvml()
            except Exception:
                self._nvml = None
        return self._via_smi()
