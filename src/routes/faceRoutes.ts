// src/routes/faceRoutes.ts
import { Router } from "express";
import {
  registerFace,
  recognizeFace,
  getFaces,
  getLogs,
  updateFace,
  deleteFace,
} from "../controllers/faceController";
import { upload } from "../middleware/upload";

const router = Router();

// Endpoint POST (Menerima Data)
router.post('/register', upload.single('image'), registerFace);
router.post('/recognize', upload.single('image'), recognizeFace);

// Endpoint GET (Mengambil Data)
router.get('/faces', getFaces);
router.get('/logs', getLogs);

// Endpoint PUT & DELETE (Modifikasi Data)
router.put('/faces/:id', updateFace); // Gunakan :id sebagai parameter dinamis
router.delete('/faces/:id', deleteFace);

export default router;
