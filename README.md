# 🚨 Rapid Crisis Response (RCR)
### *Synchronized Full-Stack Crisis Coordination for Hospitality*

[![Hackathon](https://img.shields.io/badge/Google-Hackathon--Project-4285F4?logo=google)](https://github.com/)
[![Next.js](https://img.shields.io/badge/Frontend-Next.js%2014-black?logo=next.js)](https://nextjs.org/)
[![Node.js](https://img.shields.io/badge/Backend-Node.js-339933?logo=node.js)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Analytics-Python%203.9-3776AB?logo=python)](https://python.org)

---

## 📌 Overview
Hospitality venues face unpredictable emergencies where communication is often siloed. **RCR** is a robust, full-stack solution designed to bridge the gap between guests, staff, and responders. By integrating **Real-time Node.js backend** with **Python-driven analytics**, we eliminate fragmented communication and accelerate life-saving actions.

---

## 📊 Data Visualization & Analytics
Analytics engine (Python-based) raw emergency data ko actionable insights mein convert karta hai:

| **Crisis Distribution** | **Response Latency Trends** |
|---|---|
| ![Severity](severity_distribution.png) | ![Latency](response_latency.png) |
| *Categorizing emergencies for resource allocation.* | *Tracking time-to-resolution performance.* |

> **Tech Note:** Analysis is performed via Python (Pandas/Seaborn) and served to the Next.js frontend through a secure API layer.

---

## 🛠️ Full-Stack Architecture

### **Frontend (Next.js)**
* **User Interface:** Aesthetic Black & Purple theme for low visual fatigue.
* **Real-time Updates:** Client-side hydration for instant SOS alerts.
* **Responsiveness:** Fully optimized for mobile (guests) and desktop (command center).

### **Backend (Node.js & Express)**
* **Core Logic:** Managing user sessions and crisis reporting flow.
* **Orchestration:** Serving as the bridge between the frontend and the Python analytics microservice.
* **Security:** Ensuring distressed data is handled with high reliability.

### **Analytics Engine (Python)**
* **Intelligence:** Processing historical logs using **Pandas** and **NumPy**.
* **Visualization:** Generating high-fidelity trend charts using **Matplotlib** and **Seaborn**.

---

## 🚀 Setup & Execution

### 1. Backend (Node.js)
```bash
cd backend
npm install
npm start
