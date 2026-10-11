# ZERO HOUR Web Game

Reusable self-hosted web deployment for the ZERO HOUR game. This repository contains the Python web host and leaderboard API, the exported Godot Web client, and systemd templates. The original editable Godot project is not present in the server deployment; `public/` is the exported client build.

## Contents

- `server.py` — serves the game and provides the player registration and leaderboard API.
- `redirect_http.py` — redirects HTTP requests to the configured HTTPS origin.
- `public/` — Godot Web export, including the `.pck`, `.wasm`, JavaScript, HTML, and image assets.
- `deploy/systemd/` — reusable systemd service templates.

Runtime databases, generated player identity keys, TLS certificates, and private keys are intentionally excluded. The server creates its data directory and identity key at startup.

## Requirements

- Linux with Python 3.10 or newer (the deployed server runs on Ubuntu 24.04 / Python 3.12).
- A TLS certificate and key if serving HTTPS directly from `server.py`.

## Run locally

From the repository root:

```sh
HOST=127.0.0.1 PORT=8088 SERVER_DATA_DIR=./server_data python3 server.py
```

Without `TLS_CERT_FILE` and `TLS_KEY_FILE`, the server uses plain HTTP. To enable TLS, set both environment variables to certificate files readable by the process:

```sh
TLS_CERT_FILE=/path/to/fullchain.pem \
TLS_KEY_FILE=/path/to/privkey.pem \
HOST=127.0.0.1 PORT=8088 \
SERVER_DATA_DIR=./server_data \
python3 server.py
```

Open `http://127.0.0.1:8088/` when running without TLS.

## Deploy with systemd

Review `deploy/systemd/zero-hour-web.service` and `deploy/systemd/zero-hour-redirect.service`, then adjust paths and the HTTPS origin for your host. `redirect_http.py` reads `HTTPS_ORIGIN` from its environment; set it to the public HTTPS URL. The web service expects the game export in `public/` beside `server.py`. Run the services behind a firewall that exposes only the ports you intend to serve.

For a TLS deployment, copy `deploy/systemd/web.env.example` to `/etc/zero-hour/web.env`, then set `TLS_CERT_FILE` and `TLS_KEY_FILE` to certificate files readable by `www-data`. Configure your ACME client to copy renewed certificate files to those paths and restart `zero-hour-web.service` after renewal. For IP-address certificates, check your certificate authority's short validity period and automate renewal.

## Data and privacy

The leaderboard database and player identity secret are runtime data. Keep the data directory out of version control and back it up separately if you need to preserve leaderboard records. Do not commit certificate or private-key files.

