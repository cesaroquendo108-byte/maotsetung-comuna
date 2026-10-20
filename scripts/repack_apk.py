#!/usr/bin/env python3
"""
Uroprofin Android APK Repacker and V2 Signer.

Updates web assets inside the Capacitor Android APK, aligns uncompressed
entries to 4-byte boundaries, and signs the resulting APK using Android
APK Signature Scheme v2 (RSASSA-PKCS1-v1_5 with SHA-256).
"""

import datetime
import hashlib
import io
import os
import struct
import sys
import zipfile
import zlib
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

DEFAULT_KEYSTORE = Path.home() / ".android" / "debug.keystore"
KEYSTORE_PASS = b"android"
KEY_ALIAS = b"androiddebugkey"

CHUNK_SIZE = 1048576  # 1MB chunk size for APK Signature Scheme v2
APK_SIG_BLOCK_MAGIC = b"APK Sig Block 42"
APK_SIGNATURE_SCHEME_V2_BLOCK_ID = 0x7109871A
ALGO_ID_RSA_PKCS1_V1_5_SHA256 = 0x0103


def get_or_create_debug_keystore(keystore_path: Path):
    """Load or generate a standard Android debug keystore."""
    if keystore_path.exists():
        with open(keystore_path, "rb") as f:
            key, cert, _ = pkcs12.load_key_and_certificates(f.read(), KEYSTORE_PASS)
            if key and cert:
                return key, cert

    keystore_path.parent.mkdir(parents=True, exist_ok=True)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Android"),
        x509.NameAttribute(NameOID.COMMON_NAME, "Android Debug"),
    ])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1))
        .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=10000))
        .sign(key, hashes.SHA256())
    )

    p12 = pkcs12.serialize_key_and_certificates(
        name=KEY_ALIAS,
        key=key,
        cert=cert,
        cas=None,
        encryption_algorithm=serialization.BestAvailableEncryption(KEYSTORE_PASS),
    )
    with open(keystore_path, "wb") as f:
        f.write(p12)

    return key, cert


def build_and_sign_apk(
    source_apk_path: str,
    web_assets_dir: str,
    output_paths: list[str],
    keystore_path: Path = DEFAULT_KEYSTORE,
) -> None:
    """Repack and sign APK with updated web assets."""
    key, cert = get_or_create_debug_keystore(keystore_path)

    with open(source_apk_path, "rb") as f:
        source_data = f.read()

    source_zip = zipfile.ZipFile(io.BytesIO(source_data), "r")

    # Native & config files to copy
    all_entries = []
    cap_files = {}
    for cf in ["capacitor.config.json", "capacitor.plugins.json"]:
        p = Path("android/app/src/main/assets") / cf
        if p.exists():
            with open(p, "rb") as cff:
                cap_files["assets/" + cf] = cff.read()

    for info in source_zip.infolist():
        # Exclude old web bundle
        if info.filename.startswith("assets/public/"):
            continue
        # Exclude legacy signature files from META-INF
        if info.filename.startswith("META-INF/"):
            if not ("app-metadata.properties" in info.filename or info.filename.endswith(".version")):
                continue
        # Update capacitor configs if present
        if info.filename in cap_files:
            all_entries.append((info.filename, cap_files[info.filename], 8))
            continue
        all_entries.append((info.filename, source_zip.read(info), info.compress_type))

    # Add fresh web assets from web_assets_dir
    web_base = Path(web_assets_dir)
    if not web_base.exists():
        raise FileNotFoundError(f"Web assets directory not found: {web_assets_dir}")

    for root, _, files in os.walk(web_base):
        for fn in sorted(files):
            full_p = Path(root) / fn
            rel_p = full_p.relative_to(web_base).as_posix()
            # Prevent recursive inclusion of downloaded APK
            if rel_p.startswith("downloads/"):
                continue
            with open(full_p, "rb") as wf:
                wdata = wf.read()
            apk_path = f"assets/public/{rel_p}"
            ext = full_p.suffix.lower()
            method = 0 if ext in [".png", ".jpg", ".jpeg", ".webp", ".woff2"] else 8
            all_entries.append((apk_path, wdata, method))

    # Construct Part 1 (Local file entries) and collect CD data
    out_buf = bytearray()
    cd_entries = []
    dos_time = 0
    dos_date = 0x5421

    for name, data, method in all_entries:
        name_bytes = name.encode("utf-8")
        crc = zlib.crc32(data) & 0xFFFFFFFF
        usize = len(data)

        if method == 8:
            comp_obj = zlib.compressobj(
                level=9,
                method=zlib.DEFLATED,
                wbits=-15,
                memLevel=8,
                strategy=zlib.Z_DEFAULT_STRATEGY,
            )
            cdata = comp_obj.compress(data) + comp_obj.flush()
            csize = len(cdata)
            extra = b""
        else:
            method = 0
            cdata = data
            csize = usize
            cur_offset = len(out_buf)
            lfh_base = 30 + len(name_bytes)
            rem = (cur_offset + lfh_base) % 4
            pad = (4 - rem) % 4
            extra = b"\x00" * pad

        local_offset = len(out_buf)
        lfh = struct.pack(
            "<IHHHHHIIIHH",
            0x04034B50,
            20,
            0,
            method,
            dos_time,
            dos_date,
            crc,
            csize,
            usize,
            len(name_bytes),
            len(extra),
        )
        out_buf.extend(lfh)
        out_buf.extend(name_bytes)
        out_buf.extend(extra)
        out_buf.extend(cdata)

        cd_entries.append({
            "name": name_bytes,
            "method": method,
            "crc": crc,
            "csize": csize,
            "usize": usize,
            "offset": local_offset,
        })

    part1 = bytes(out_buf)
    cd_offset = len(part1)

    # Construct Part 2 (Central Directory)
    cd_buf = bytearray()
    for entry in cd_entries:
        cdh = struct.pack(
            "<IHHHHHHIIIHHHHHII",
            0x02014B50,
            0x0314,
            20,
            0,
            entry["method"],
            dos_time,
            dos_date,
            entry["crc"],
            entry["csize"],
            entry["usize"],
            len(entry["name"]),
            0,
            0,
            0,
            0,
            0x81A40000,
            entry["offset"],
        )
        cd_buf.extend(cdh)
        cd_buf.extend(entry["name"])

    part2 = bytes(cd_buf)
    cd_size = len(part2)
    total_entries = len(cd_entries)

    # Construct Part 3 (EOCD with original cd_offset before signing block insertion)
    part3 = struct.pack(
        "<IHHHHIIH",
        0x06054B50,
        0,
        0,
        total_entries,
        total_entries,
        cd_size,
        cd_offset,
        0,
    )

    # APK Signature Scheme v2: 1MB chunk tree hash
    chunks = (
        [part1[i : i + CHUNK_SIZE] for i in range(0, len(part1), CHUNK_SIZE)]
        + [part2[i : i + CHUNK_SIZE] for i in range(0, len(part2), CHUNK_SIZE)]
        + [part3[i : i + CHUNK_SIZE] for i in range(0, len(part3), CHUNK_SIZE)]
    )
    chunk_hashes = [
        hashlib.sha256(b"\xa5" + struct.pack("<I", len(c)) + c).digest()
        for c in chunks
    ]
    root_digest = hashlib.sha256(
        b"\x5a" + struct.pack("<I", len(chunks)) + b"".join(chunk_hashes)
    ).digest()

    # Build SignedData structure
    dentry = struct.pack("<II", ALGO_ID_RSA_PKCS1_V1_5_SHA256, len(root_digest)) + root_digest
    dseq = struct.pack("<I", len(dentry)) + dentry
    digests_block = struct.pack("<I", len(dseq)) + dseq

    cert_der = cert.public_bytes(serialization.Encoding.DER)
    cseq = struct.pack("<I", len(cert_der)) + cert_der
    certs_block = struct.pack("<I", len(cseq)) + cseq

    attrs_block = struct.pack("<I", 0)
    signed_data = digests_block + certs_block + attrs_block

    # Sign with RSA-2048
    sig = key.sign(signed_data, padding.PKCS1v15(), hashes.SHA256())
    sentry = struct.pack("<II", ALGO_ID_RSA_PKCS1_V1_5_SHA256, len(sig)) + sig
    sseq = struct.pack("<I", len(sentry)) + sentry
    sigs_block = struct.pack("<I", len(sseq)) + sseq

    pk_der = key.public_key().public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    pk_block = struct.pack("<I", len(pk_der)) + pk_der

    signer = struct.pack("<I", len(signed_data)) + signed_data + sigs_block + pk_block
    signers = struct.pack("<I", len(signer)) + signer
    v2_val = struct.pack("<I", len(signers)) + signers

    # Build APK Signing Block
    pair = struct.pack("<QI", len(v2_val) + 4, APK_SIGNATURE_SCHEME_V2_BLOCK_ID) + v2_val
    block_size = len(pair) + 8 + 16
    signing_block = (
        struct.pack("<Q", block_size)
        + pair
        + struct.pack("<Q", block_size)
        + APK_SIG_BLOCK_MAGIC
    )

    # Update EOCD with new Central Directory offset
    new_cd_offset = len(part1) + len(signing_block)
    new_eocd = struct.pack(
        "<IHHHHIIH",
        0x06054B50,
        0,
        0,
        total_entries,
        total_entries,
        cd_size,
        new_cd_offset,
        0,
    )

    final_apk = part1 + signing_block + part2 + new_eocd

    # Self-verification of final APK
    verify_apk(final_apk, key.public_key())

    # Write output APK to all requested paths
    for outp in output_paths:
        out_path = Path(outp)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "wb") as f:
            f.write(final_apk)
        print(f"Wrote signed APK to: {outp} ({len(final_apk) / 1024 / 1024:.2f} MB)")


def verify_apk(apk_bytes: bytes, pubkey: rsa.RSAPublicKey) -> None:
    """Verify ZIP integrity, 4-byte uncompressed alignment, Merkle tree hash, and RSA signature."""
    f = io.BytesIO(apk_bytes)
    eocd_idx = apk_bytes.rfind(b"\x50\x4b\x05\x06")
    if eocd_idx == -1:
        raise ValueError("Invalid ZIP: EOCD not found")

    cd_size, cd_offset = struct.unpack("<II", apk_bytes[eocd_idx + 12 : eocd_idx + 20])
    magic = apk_bytes[cd_offset - 16 : cd_offset]
    if magic != APK_SIG_BLOCK_MAGIC:
        raise ValueError("APK Signing Block magic missing or incorrect")

    block_size = struct.unpack("<Q", apk_bytes[cd_offset - 24 : cd_offset - 16])[0]
    block_start = cd_offset - 8 - block_size

    # Verify v2 signing block ID
    pair_len = struct.unpack("<Q", apk_bytes[block_start + 8 : block_start + 16])[0]
    pair_id = struct.unpack("<I", apk_bytes[block_start + 16 : block_start + 20])[0]
    if pair_id != APK_SIGNATURE_SCHEME_V2_BLOCK_ID:
        raise ValueError(f"Expected v2 signature scheme block ID, found 0x{pair_id:08x}")

    # Reconstruct chunks
    part1 = apk_bytes[:block_start]
    part2 = apk_bytes[cd_offset:eocd_idx]
    eocd_mod = bytearray(apk_bytes[eocd_idx:])
    struct.pack_into("<I", eocd_mod, 16, block_start)
    part3 = bytes(eocd_mod)

    chunks = (
        [part1[i : i + CHUNK_SIZE] for i in range(0, len(part1), CHUNK_SIZE)]
        + [part2[i : i + CHUNK_SIZE] for i in range(0, len(part2), CHUNK_SIZE)]
        + [part3[i : i + CHUNK_SIZE] for i in range(0, len(part3), CHUNK_SIZE)]
    )
    chunk_hashes = [
        hashlib.sha256(b"\xa5" + struct.pack("<I", len(c)) + c).digest()
        for c in chunks
    ]
    computed_digest = hashlib.sha256(
        b"\x5a" + struct.pack("<I", len(chunks)) + b"".join(chunk_hashes)
    ).digest()

    # Extract signed data and signature
    v2_val = apk_bytes[block_start + 20 : block_start + 8 + pair_len]
    signers_len = struct.unpack("<I", v2_val[:4])[0]
    slen = struct.unpack("<I", v2_val[4:8])[0]
    signer = v2_val[8 : 8 + slen]

    sd_len = struct.unpack("<I", signer[:4])[0]
    signed_data = signer[4 : 4 + sd_len]
    rem = signer[4 + sd_len :]

    sig_seq_len = struct.unpack("<I", rem[:4])[0]
    sigs = rem[4 : 4 + sig_seq_len]
    salgo, s_len = struct.unpack("<II", sigs[4:12])
    sig_bytes = sigs[12 : 12 + s_len]

    # Verify RSA signature
    pubkey.verify(sig_bytes, signed_data, padding.PKCS1v15(), hashes.SHA256())

    # Verify digest inside signed_data
    digests_seq_len = struct.unpack("<I", signed_data[:4])[0]
    digests_data = signed_data[4 : 4 + digests_seq_len]
    algo_id = struct.unpack("<I", digests_data[4:8])[0]
    d_len = struct.unpack("<I", digests_data[8:12])[0]
    sig_digest = digests_data[12 : 12 + d_len]

    if sig_digest != computed_digest:
        raise ValueError("Computed tree digest does not match signature digest")

    # Verify ZIP structure and 4-byte alignment
    zf = zipfile.ZipFile(f)
    for info in zf.infolist():
        if info.compress_type == 0:
            f.seek(info.header_offset)
            lfh = f.read(30)
            _, _, _, _, _, _, _, _, _, nlen, elen = struct.unpack("<IHHHHHIIIHH", lfh)
            data_offset = info.header_offset + 30 + nlen + elen
            if data_offset % 4 != 0:
                raise ValueError(f"Entry {info.filename} is not 4-byte aligned (offset: {data_offset})")

    print(f"Verified APK successfully: {len(zf.namelist())} entries, v2 signature valid, 4-byte aligned.")


if __name__ == "__main__":
    src = "public/downloads/uroprofin.apk"
    web = "android/app/src/main/assets/public"
    outputs = [
        "public/downloads/uroprofin.apk",
        "dist/downloads/uroprofin.apk",
    ]
    build_and_sign_apk(src, web, outputs)
