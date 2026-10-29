# Production & Docker Deployment Guide

This guide covers deploying Smart Classroom AI using Docker Compose or standalone production environments.

---

## 1. Production Docker Compose Deployment

The fastest way to deploy all four services (MongoDB, AI Microservice, Node.js Backend, and React Frontend) is via `docker-compose.yml`.

### Prerequisites
* Docker Engine 24+ and Docker Compose v2+
* Minimum 4GB RAM and 2 CPU cores

### Deployment Steps

1. Clone the repository and navigate into it:
   ```bash
   git clone <repo-url> smart-classroom-ai
   cd smart-classroom-ai
   ```

2. Create production `.env` file:
   ```bash
   cp .env.example .env
   ```
   *Ensure you update `JWT_SECRET` and `ADMIN_PASSWORD` with strong, random credentials.*

3. Build and launch all services in detached mode:
   ```bash
   docker compose up -d --build
   ```

4. Verify all containers are running:
   ```bash
   docker compose ps
   ```

5. Seed the default admin user:
   ```bash
   docker compose exec backend npm run seed
   ```

6. Access the dashboard:
   * **Web Dashboard**: `http://<SERVER_IP>:5173`
   * **Backend API**: `http://<SERVER_IP>:5000`
   * **AI Microservice**: `http://<SERVER_IP>:8000`

---

## 2. Docker Service Topology

| Service | Container Name | Port | Purpose |
|---|---|---|---|
| `mongodb` | `smart-classroom-mongodb` | 27017 | Database engine & persistent storage volume (`mongo_data`) |
| `ai-service` | `smart-classroom-ai-service` | 8000 | FastAPI, YOLOv8, and ArcFace biometric engine |
| `backend` | `smart-classroom-backend` | 5000 | Express API, WebRTC signaling, uploads volume (`backend_uploads`) |
| `frontend` | `smart-classroom-frontend` | 5173 | Vite React SPA client |

---

## 3. WebRTC & NAT Considerations in Production

* **Local Area Network (LAN)**: Default Google STUN (`stun:stun.l.google.com:19302`) works directly between smartphones and computers on the same router/subnet.
* **Wide Area Network (WAN / Public Internet)**: Symmetric NATs and mobile 4G/5G carrier-grade NATs (CGNAT) block direct P2P video connections. You **must configure a TURN server** (e.g., Coturn):
  ```env
  TURN_URL=turn:turn.yourdomain.com:3478
  TURN_USERNAME=turnuser
  TURN_CREDENTIAL=turnpassword
  ```

---

## 4. Security & Biometric Data Privacy

1. **Embedding vs. Raw Photo**:
   * Stored embeddings are 128-dimensional floating point vectors. They are non-invertible mathematical projections from which original human face photos cannot be reconstructed.
2. **Access Control**:
   * All biometric endpoints (`/api/students/enroll`, `/api/students/:id/enrollment`) require valid Admin JWT authentication.
3. **Data Erasure**:
   * Administrators can instantly wipe biometric embeddings for any student at any time using the "Wipe Biometrics" action on the Students page.
4. **HTTPS / TLS in Production**:
   * Mobile phone camera access via `navigator.mediaDevices.getUserMedia` requires a secure context (`https://` or `localhost`). In production, place Nginx, Caddy, or Cloudflare in front of the services with a valid SSL/TLS certificate.
