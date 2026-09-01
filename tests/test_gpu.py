from hyte_panel.collectors.gpu import parse_nvidia_smi


def test_parse_nvidia_smi_csv():
    out = "NVIDIA GeForce RTX 5090, 37, 61, 4096, 32768, 210.55, 575.00, 45, 2520, 14001\n"
    gpus = parse_nvidia_smi(out)
    assert len(gpus) == 1
    g = gpus[0]
    assert g["name"] == "NVIDIA GeForce RTX 5090"
    assert g["util_percent"] == 37
    assert g["mem_percent"] == 12.5
    assert g["power_w"] == 210.55
    assert g["clock_mem_mhz"] == 14001


def test_parse_nvidia_smi_handles_na_and_junk():
    out = "GPU X, [N/A], N/A, 100, 1000, [Not Supported], , 0, 100, 200\nshort,line\n"
    g = parse_nvidia_smi(out)
    assert len(g) == 1
    assert g[0]["util_percent"] is None
    assert g[0]["temp_c"] is None
    assert g[0]["power_w"] is None
    assert g[0]["power_limit_w"] is None
    assert g[0]["mem_percent"] == 10.0
