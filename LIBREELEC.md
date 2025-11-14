# GitLab Pipeline Monitor - LibreELEC Deployment Guide

This guide covers deploying the GitLab Pipeline Monitor on LibreELEC (tested on version 12).

## 🔍 About LibreELEC

LibreELEC is a lightweight Linux distribution for Kodi media centers. Important characteristics:

- **Read-only filesystem**: Most of the system is read-only for stability
- **Persistent storage**: Only `/storage` is writable and persistent across reboots
- **Docker included**: Docker comes pre-installed (accessible via SSH)
- **No package manager**: No apt/yum - system updates via LibreELEC interface
- **Minimal tooling**: Limited shell utilities (no git by default)

## 📋 Prerequisites

1. LibreELEC 12 installed on your Pi5
2. SSH access enabled (Settings → LibreELEC → Services → Enable SSH)
3. Network connectivity
4. Your Pi5's IP address

## 🚀 Quick Start for LibreELEC

### 1. Connect via SSH

```bash
# From your computer
ssh root@<pi5-ip>
# Default password: libreelec
```

### 2. Navigate to persistent storage

```bash
cd /storage
mkdir -p docker/gitlab-monitor
cd docker/gitlab-monitor
```

### 3. Get the project files

Since LibreELEC doesn't have git, you have two options:

**Option A: Download release archive (recommended)**

```bash
# Download latest release (replace URL with actual release)
wget https://github.com/genuinefafa/gitlab-pipeline-status-single/archive/refs/heads/main.zip

# LibreELEC has unzip
unzip main.zip
mv gitlab-pipeline-status-single-main/* .
mv gitlab-pipeline-status-single-main/.* . 2>/dev/null || true
rm -rf gitlab-pipeline-status-single-main main.zip
```

**Option B: Use scp/rsync from your computer**

```bash
# From your computer (not on Pi5)
# Clone the repo locally first
git clone https://github.com/genuinefafa/gitlab-pipeline-status-single.git
cd gitlab-pipeline-status-single

# Copy to Pi5
scp -r * root@<pi5-ip>:/storage/docker/gitlab-monitor/
```

### 4. Create configuration

```bash
# Still on Pi5 SSH session
cd /storage/docker/gitlab-monitor

# Copy example config
cp config.example.yaml config.yaml

# Edit with vi (LibreELEC's default editor)
vi config.yaml
```

**Minimal config.yaml example:**

```yaml
servers:
  - url: https://gitlab.com
    tokens:
      - your-gitlab-token-here
    groups:
      - path: your-group/your-project
        includeSubgroups: false

refreshIntervals:
  groups: 1800000
  branches: 300000
  pipelines: 30000
```

To edit in vi:
- Press `i` to enter insert mode
- Make your changes
- Press `ESC` then type `:wq` and press ENTER to save

### 5. Build and start (LibreELEC doesn't have docker-compose)

**LibreELEC 12 doesn't include docker-compose**, so you need to use pure Docker commands.

**Option A: Use the deployment script (easiest)**

```bash
# Make script executable
chmod +x docker-manual-deploy.sh

# Run the deployment script
./docker-manual-deploy.sh
```

The script will:
- ✅ Check config exists
- ✅ Create cache volume
- ✅ Build the image
- ✅ Stop old container (if exists)
- ✅ Start new container
- ✅ Show access information

**Option B: Manual Docker commands (step by step)**

```bash
# 1. Create volume for cache
docker volume create gitlab-cache

# 2. Build the image (takes 5-10 minutes on Pi5)
docker build -t gitlab-monitor:latest .

# 3. Run the container
docker run -d \
  --name gitlab-monitor \
  --restart unless-stopped \
  -p 3000:3000 \
  -v "$(pwd)/config.yaml:/app/config.yaml:ro" \
  -v gitlab-cache:/app/.cache \
  -e NODE_ENV=production \
  gitlab-monitor:latest

# 4. Check logs
docker logs -f gitlab-monitor
```

**Useful commands:**

```bash
# View logs
docker logs -f gitlab-monitor

# Stop container
docker stop gitlab-monitor

# Start container
docker start gitlab-monitor

# Restart container
docker restart gitlab-monitor

# Remove container (doesn't delete volume)
docker rm -f gitlab-monitor

# Rebuild after changes
docker build -t gitlab-monitor:latest . --no-cache
docker stop gitlab-monitor
docker rm gitlab-monitor
# Then run the docker run command again
```

### 6. Configure network access

**Option A: Access by IP (simplest)**

From any browser on your network:
- GitLab Monitor: `http://<pi5-ip>`
- Portainer: `http://<pi5-ip>:9000`

**Option B: Use .local domains**

Add to your computer's `/etc/hosts` (Mac/Linux) or `C:\Windows\System32\drivers\etc\hosts` (Windows):

```
<pi5-ip>  gitlab.local
<pi5-ip>  pihole.local
```

Then access via:
- GitLab Monitor: `http://gitlab.local`
- Portainer: `http://<pi5-ip>:9000`

## 🔧 LibreELEC-Specific Configuration

### Docker location

All Docker data should be under `/storage/docker/` for persistence. Our setup at `/storage/docker/gitlab-monitor` is perfect.

### Persistence across reboots

Everything under `/storage` persists across reboots. Your configuration includes:

```
/storage/docker/gitlab-monitor/
├── config.yaml                 # Your GitLab config (persists)
├── docker-manual-deploy.sh     # Deployment script (persists)
├── Dockerfile                  # Build file (persists)
├── src/                        # Source code (persists)
├── public/                     # Static files (persists)
└── ... (all project files persist)
```

Docker volumes are stored in `/storage/docker/volumes/`:
```
/storage/docker/volumes/
├── gitlab-cache/        # Pipeline cache
└── portainer-data/      # Portainer settings
```

### Auto-start on boot

**Option 1: Using LibreELEC's autostart.sh**

```bash
# Create or edit autostart script
vi /storage/.config/autostart.sh
```

Add:
```bash
#!/bin/sh
(
  sleep 30  # Wait for Docker to be ready
  docker start gitlab-monitor
) &
```

Make executable:
```bash
chmod +x /storage/.config/autostart.sh
```

**Option 2: Using Docker restart policy (already configured)**

The container is started with `--restart unless-stopped`, so it will restart automatically after reboot once Docker is ready. This is the recommended option - no autostart.sh needed!

### Checking Docker on LibreELEC

```bash
# Docker service status
systemctl status docker

# View running containers
docker ps

# View all containers (including stopped)
docker ps -a

# View Docker logs
journalctl -u docker -f
```

## 🛠️ Troubleshooting LibreELEC

### Docker not starting containers

```bash
# Check Docker daemon
systemctl status docker

# Restart Docker service
systemctl restart docker

# Check disk space
df -h /storage
```

### Out of disk space

LibreELEC SD cards can be small. Clean up:

```bash
# Remove unused Docker images
docker image prune -a

# Remove unused volumes
docker volume prune

# Check Docker disk usage
docker system df
```

### Can't edit files

Remember: Only `/storage` is writable. Don't try to edit files in `/usr`, `/etc`, etc.

```bash
# ✅ Works (in /storage)
vi /storage/docker/gitlab-monitor/config.yaml

# ❌ Fails (read-only filesystem)
vi /etc/some-file
```

### Networking issues

```bash
# Check Pi5 IP address
ip addr show

# Check if port 80 is listening
netstat -tlnp | grep :80

# Check if nginx container is running
docker ps | grep nginx

# Check nginx logs
docker logs nginx-proxy
```

### Need to reset everything

```bash
cd /storage/docker/gitlab-monitor

# Stop and remove container
docker stop gitlab-monitor
docker rm gitlab-monitor

# Remove volumes (WARNING: deletes all cached data)
docker volume rm gitlab-cache

# Restart fresh
./docker-manual-deploy.sh
# Or manually: docker run -d --name gitlab-monitor ...
```

## 📊 Resource Usage on Pi5

Expected resource usage:

| Service | RAM | CPU (idle) | Storage |
|---------|-----|------------|---------|
| Nginx | ~5MB | <1% | ~10MB |
| GitLab Monitor | ~100MB | 1-2% | ~50MB |
| Portainer | ~50MB | <1% | ~30MB |
| **Total** | **~155MB** | **2-4%** | **~90MB** |

This is minimal and won't affect Kodi performance.

## 🔐 Using Docker Secrets on LibreELEC

For sensitive data, store them in separate files with restricted permissions:

```bash
# Create password/token files
cd /storage/docker/gitlab-monitor
echo "your-secure-password" > gitlab_token.txt
chmod 600 gitlab_token.txt

# Reference in config.yaml instead of hardcoding
# config.yaml uses the token directly, but keeping it
# in a separate file allows better access control
```

For more advanced secrets management with docker-compose (requires installing compose), see DEPLOYMENT.md "Docker Secrets" section.

## 🔄 Updating the Application

Since LibreELEC doesn't have git:

```bash
cd /storage/docker/gitlab-monitor

# 1. Stop and remove container
docker stop gitlab-monitor
docker rm gitlab-monitor

# 2. Backup your config
cp config.yaml /storage/config.yaml.backup

# 3. Download new version
wget https://github.com/genuinefafa/gitlab-pipeline-status-single/archive/refs/heads/main.zip
unzip main.zip
cp -r gitlab-pipeline-status-single-main/* .
rm -rf gitlab-pipeline-status-single-main main.zip

# 4. Restore your config
cp /storage/config.yaml.backup config.yaml

# 5. Rebuild and restart
chmod +x docker-manual-deploy.sh
./docker-manual-deploy.sh
```

## 💡 Tips for LibreELEC

1. **No docker-compose needed**: The manual script handles everything
2. **SSH keys**: Set up SSH key authentication instead of password
3. **Backups**: Regularly backup `/storage/docker/gitlab-monitor/config.yaml`
4. **Monitoring**: Keep an eye on disk space with `df -h /storage`
5. **Logs**: Use `docker logs -f gitlab-monitor` to monitor application logs
6. **Updates**: Subscribe to GitHub releases for notifications
7. **Auto-restart**: The `--restart unless-stopped` policy means it survives reboots

## 📚 Additional Resources

- [LibreELEC Wiki](https://wiki.libreelec.tv/)
- [LibreELEC Docker Documentation](https://wiki.libreelec.tv/configuration/docker)
- [Main Deployment Guide](DEPLOYMENT.md)
- [Project README](README.md)

## 🆘 Getting Help

If you encounter issues specific to LibreELEC:

1. Check LibreELEC system logs: `journalctl -xe`
2. Check Docker logs: `docker logs -f gitlab-monitor`
3. Verify Docker is running: `systemctl status docker`
4. Check available disk space: `df -h`
5. Check container status: `docker ps -a`
6. Report issues on GitHub with "LibreELEC" label
