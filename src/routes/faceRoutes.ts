// src/routes/faceRoutes.ts
import { Router } from "express";
import {
  registerFace,
  recognizeFace,
  getFaces,
  getLogs,
  updateFace,
  deleteFace,
  deleteLog,
} from "../controllers/faceController";
import { upload } from "../middleware/upload";

const router = Router();

// Endpoint POST (Menerima Data)
router.post('/register', upload.single('image'), registerFace);
router.post('/recognize', upload.single('image'), recognizeFace);

// Endpoint GET (Mengambil Data)
router.get('/faces', getFaces);
router.get('/logs', getLogs); // Ini sekarang sudah versi Super (ada filter & statistik)

// Endpoint PUT & DELETE (Modifikasi Data Master Wajah)
router.put('/faces/:id', updateFace);
router.delete('/faces/:id', deleteFace);

// Endpoint DELETE KHUSUS (Modifikasi Data Log Absensi)
router.delete('/logs/:id', deleteLog);

export default router;
