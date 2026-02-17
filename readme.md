# Local Video Smart-Processing Engine

## 1. Project Overview
ระบบ Local Service สำหรับจัดการคิวงาน **Video Re-encoding (NVENC)** และ **Subtitle Extraction** โดยเน้นการคัดกรองไฟล์อัจฉริยะ (Smart Filtering) เพื่อลดการทำงานซ้ำซ้อน และจัดการไฟล์ใน Archive ด้วยเงื่อนไขพิเศษ (MD5/Regex) รันบนเครื่อง Local GPU และจัดเก็บข้อมูลบน NAS (Mapped Drive)

---

## 2. System Architecture & Workflow
ระบบทำงานแบบ **Event-Driven + Queue Base** โดยแบ่งเป็น 3 ส่วนหลัก:

- **The Watcher**: เฝ้าดู Input Folder, ทำความสะอาดชื่อไฟล์ด้วย Regex และเช็คความซ้ำซ้อนจาก Database
- **The Worker**: ประมวลผล Heavy-duty tasks (FFmpeg NVENC, Subtitle Extraction, Quality Measurement)
- **The Web Dashboard**: แสดงสถานะการทำงาน, ผลลัพธ์คุณภาพ (SSIM/PSNR), และปุ่มควบคุม Manual Actions

---

## 3. Core Logic & Processing Rules

### A. Filename Sanitization (Regex)
- **Configuration**: กำหนดได้ที่ `src/config/index.js` (รองรับหลาย Pattern)
- **Default Patterns**: 
  1. `^.*?@?([A-Za-z0-9]{1,6}-[0-9]{1,5}(?:-[pP][tT]\d+)?)\.(mp4|mkv)$` 
     - รองรับ: `VDO-001`, `VDO-001-pt1`, `VDO-001-pt2`
  2. `^.*?@([A-Za-z0-9]+-[A-Za-z0-9]+-[0-9]{4,9}(?:-[pP][tT]\d+)?)\.(mp4|mkv)$`
     - รองรับ: `ABC-DEF-123456`, `ABC-DEF-123456-pt1`
- **Transformation**: 
  - Regex Group 1 = **Series ID** (เช่น `VDO-001` หรือ `VDO-001-pt1`)
  - **Filename Logic**: 
    - **Base ID**: UPPERCASE (`VDO-001`)
    - **Suffix (ถ้ามี)**: lowercase (`-pt1`)
    - **Result**: `VDO-001.mp4` หรือ `VDO-001-pt1.mp4`
  - **Extension**: แปลงเป็น lowercase (Default: `.mp4`)

### B. Decision Matrix (The Filter)
1. **Legacy Check**: หากพบ Cleaned Name ใน DB เก่า (`Status: Completed/Legacy`) -> **Skip Re-encode** แต่ต้อง Extract Subtitle เสมอ
2. **New File**: หากไม่พบใน DB -> ทำการ Full Process (Extract Sub + NVENC Encode)
3. **Duplicate Check**: หากทำเสร็จแล้วตรวจพบไฟล์ชื่อเดียวกันใน Archive:
   - **MD5/Size ตรงกัน**: ลบไฟล์ที่ทำใหม่ทิ้ง (Delete Temp)
   - **MD5/Size ต่างกัน**: ย้ายเข้า Archive โดยเพิ่ม Suffix เช่น `VDO-001_a1b2.mp4` เพื่อป้องกันไฟล์หาย

### C. Video Encoding Settings (NVENC)
- **Codec**: HEVC (NVENC)
- **Settings**:
  - `Preset`: p7
  - `Tune`: hq
  - `RC`: constqp
  - `QP`: 24
- **Quality Check**: หลังทำเสร็จต้องรัน `psnr` และ `ssim` เทียบกับ Original และบันทึกค่าลง DB

---

## 4. Database Schema (SQLite)

| Table Name | Description |
|------------|-------------|
| `files_registry` | เก็บ `original_name`, `cleaned_name`, `file_hash`, `video_status`, `subtitle_status`, `is_legacy` |
| `process_logs` | เก็บ `output_path`, `ssim_score`, `psnr_score`, `error_log`, `duration_sec` |
| `system_settings` | เก็บ Config ของระบบ และสถานะการหยุดทำงาน |

---

## 5. Operations & Scheduling (Night Shift)

### Manual Start
1. User ทำการ Map Network Drive (NAS) ให้เรียบร้อย
2. เปิด Web Report เพื่อตรวจสอบงานค้าง (Interrupted Tasks)
3. สั่งรัน Main Process เพื่อเริ่มกวาดไฟล์เข้า Queue

### Auto-Stop Logic
- **Monitor Time**: เช็คเวลาเครื่องตลอดเวลา
- **Stop Sequence (08:50)**: หยุดรับงานใหม่ ปล่อยไฟล์ที่ Encode ค้างอยู่ให้เสร็จ
- **Finalize (09:00)**: ปิดการเชื่อมต่อ Database และสั่ง Shutdown Computer (`shutdown /s /t 60`)

### Importing Legacy Files
หากมีไฟล์เก่าที่เคยทำไปแล้วและต้องการข้าม Process Encode:
1. สร้างไฟล์ `data/legacy.txt`
2. ใส่รายชื่อไฟล์ (บรรทัดละ 1 ชื่อ) เช่น:
   ```text
   VDO-001.mp4
   @ABC-DEF-1234.mp4
   ```
3. รันคำสั่ง: `npm run import-legacy`
4. ระบบจะนำเข้า DB โดยตั้งค่า `video_status: completed` (ข้าม Enclode) แต่ `subtitle_status: pending` (ยังต้องแกะซับ)

---

## 6. Web Dashboard Features
- **Status Monitor**: แสดงไฟล์ที่กำลังทำ, เสร็จแล้ว, หรือถูกข้าม (พร้อมเหตุผลที่ Skip)
- **Manual Actions**: ปุ่ม Re-encode (กรณีต้องการเปลี่ยน Setting), ปุ่ม Resume งานค้าง
- **Reports**: สรุปจำนวนไฟล์ที่ทำเสร็จในแต่ละคืน และผลการวัดคุณภาพวิดีโอ

---

## 7. Technology Stack & Installation

### Core Technologies
- **Runtime**: [Node.js](https://nodejs.org/) (v16+, v20+ Recommended)
- **Database**: [SQLite](https://www.sqlite.org/) (via `better-sqlite3`)
- **Language**: JavaScript (CommonJS)

### Dependencies (NPM)
- **System**:
  - `better-sqlite3`: High-performance SQLite3 driver.
  - `winston`: Professional logging library.
  - `chokidar`: Robust file watching (replacing `fs.watch`).
- **Media Processing**:
  - `fluent-ffmpeg`: Abstraction layer for FFmpeg commands.
- **Web Dashboard**:
  - `express`: Minimalist web framework.
  - `socket.io`: Real-time bidirectional event-based communication.

### External Requirements
To run this project, the host machine **MUST** have:
1.  **FFmpeg**: Installed and added to system `PATH`.
    - Verify with: `ffmpeg -version`
2.  **NVIDIA GPU & Drivers**:
    - Required for hardware acceleration (`hevc_nvenc`).
    - Verify with: `nvidia-smi`
3.  **Network Storage (NAS)**:
    - Mapped Drive (e.g., `Z:/`) must be accessible before starting the service.

### Installation & Setup
1.  **Clone/Unzip Project**:
    ```bash
    git clone <repo_url>
    cd local-video-smart-processing-engine
    ```
2.  **Install Dependencies**:
    ```bash
    npm install
    ```
    *Note: If `better-sqlite3` fails to build, try `npm install better-sqlite3 --build-from-source` or update python/visual studio build tools.*
3.  **Configuration**:
    - Edit `src/config/index.js` to set your paths:
      - `INPUT_DIR`: Where raw videos arrive.
      - `OUTPUT_DIR`: Where processed videos go.
      - `ARCHIVE_DIR`: The NAS storage.

### Running the Application
- **Development Mode** (Auto-restart on save):
  ```bash
  npm run dev
  ```
- **Production Mode**:
  ```bash
  npm start
  ```
- **Web-Only Mode** (Dashboard only, no processing):
  ```bash
  npm run web
  ```
- **Import Legacy Files**:
  ```bash
  npm run import-legacy
  ```

---

## 8. Git & GitHub Setup

### Initial Setup (Already done)
We have initialized a local git repository and created a `.gitignore` file to exclude `node_modules`, `logs`, and local databases.

### Connect to GitHub
1.  **Create a New Repository** on GitHub (Start a project).
2.  **Copy the Repository URL** (e.g., `https://github.com/USERNAME/REPO-NAME.git`).
3.  **Run the following commands** in your terminal (inside the project folder):

```bash
# Add the remote repository
git remote add origin <YOUR_GITHUB_REPO_URL>

# Push the code to the main branch
git branch -M main
git push -u origin main
```

### Future Updates
When you make changes to the code:
```bash
git add .
git commit -m "Description of changes"
git push
```
