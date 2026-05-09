# OMB UI — Ansible Prerequisites (Client Node)

These are the system-level dependencies that must be present on the OMB **client node** before `deploy.sh` can run. They are NOT handled by `deploy.sh` itself.

## What deploy.sh handles

Once prerequisites are met, `deploy.sh` does everything else:
- `pip install -r requirements.txt`
- `npm install && npm run build`
- Writes and enables the systemd service on port 8888
- Creates `.env` interactively on first run
- `chown`s `/opt/benchmark` to the running user

## Prerequisites Ansible must install

### 1. Python pip

The default Ubuntu 22.04 image has `python3` but not `pip`:

```yaml
- name: Install python3-pip
  apt:
    name: python3-pip
    state: present
    update_cache: yes
```

### 2. Node.js 20+

The default apt repo ships Node 12, which is too old for Vite 6. Install via NodeSource:

```yaml
- name: Install NodeSource repo
  shell: curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  args:
    creates: /etc/apt/sources.list.d/nodesource.list

- name: Remove conflicting old node packages
  apt:
    name:
      - nodejs
      - libnode-dev
      - libnode72
    state: absent

- name: Install Node.js 20
  apt:
    name: nodejs
    state: present
    update_cache: yes
```

### 3. Git (if cloning the repo via git rather than rsync)

```yaml
- name: Install git
  apt:
    name: git
    state: present
```

### 4. Firewall / GCP firewall rule

Port **8888** must be open for ingress on the client node. In GCP this is a firewall rule (not managed by the OS), so it needs to be in Terraform or `gcloud`:

```
target: rp-client nodes
protocol: TCP
port: 8888
```

## What does NOT need Ansible

- `uvicorn`, `fastapi`, and all Python packages — installed by `deploy.sh` via pip
- Frontend npm packages and build — done by `deploy.sh`
- systemd service — written and enabled by `deploy.sh`
- `/opt/benchmark` permissions — fixed by `deploy.sh` (`chown -R $USER /opt/benchmark`)
