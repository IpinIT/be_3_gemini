// src/routes/faceRoutes.ts
import { Router } from "express";
import {
  registerFace,
  recognizeFace,
  getFaces,
  getLogs,
} from "../controllers/faceController";
import { upload } from "../middleware/upload";

const router = Router();

// Endpoint POST (Menerima Data)
// 'image' adalah nama field/key yang harus dipakai Flutter saat mengirim foto
router.post("/register", upload.single("image"), registerFace);
router.post("/recognize", upload.single("image"), recognizeFace);

// Endpoint GET (Mengambil Data)
router.get("/faces", getFaces);
router.get("/logs", getLogs);

export default router;
