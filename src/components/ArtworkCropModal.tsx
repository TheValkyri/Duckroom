import { Check, Move, RotateCcw, Scissors, Sparkles, X, ZoomIn } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cropBlackLetterbox, dataURLtoFile } from "../lib/image-crop";

export function ArtworkCropModal({
  imageSrc,
  onClose,
  onApply,
}: {
  imageSrc: string;
  onClose: () => void;
  onApply: (croppedFile: File, croppedDataUrl: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [aspectMode, setAspectMode] = useState<"square" | "video">("square");
  const [isProcessing, setIsProcessing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Load image object
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      drawPreview();
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // Redraw canvas whenever zoom, offset, or mode changes
  useEffect(() => {
    drawPreview();
  }, [zoom, offsetX, offsetY, aspectMode]);

  const drawPreview = () => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const targetWidth = aspectMode === "square" ? 600 : 800;
    const targetHeight = aspectMode === "square" ? 600 : 450;

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, targetWidth, targetHeight);

    // Calculate aspect cover dimensions
    const imgWidth = img.naturalWidth || img.width;
    const imgHeight = img.naturalHeight || img.height;

    const scale = Math.max(targetWidth / imgWidth, targetHeight / imgHeight) * zoom;
    const drawW = imgWidth * scale;
    const drawH = imgHeight * scale;

    const centerX = (targetWidth - drawW) / 2 + offsetX;
    const centerY = (targetHeight - drawH) / 2 + offsetY;

    ctx.drawImage(img, centerX, centerY, drawW, drawH);
  };

  const handleAutoCropBlackBars = async () => {
    setIsProcessing(true);
    try {
      const croppedUrl = await cropBlackLetterbox(imageSrc);
      if (croppedUrl && croppedUrl.startsWith("data:")) {
        const img = new Image();
        img.onload = () => {
          imgRef.current = img;
          setZoom(1);
          setOffsetX(0);
          setOffsetY(0);
          drawPreview();
        };
        img.src = croppedUrl;
      }
    } catch (e) {
      console.warn("Auto crop error:", e);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    const filename = `artwork-${aspectMode}-${Date.now()}.jpg`;
    const file = dataURLtoFile(dataUrl, filename);

    onApply(file, dataUrl);
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ scale: 0.94, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0, y: 20 }}
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-xl shadow-2xl flex flex-col gap-5 max-h-[95vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <Scissors className="size-5 text-primary" />
            <h2 className="font-display text-lg font-semibold">Căn chỉnh & Cắt ảnh Artwork</h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Live Preview Canvas */}
        <div className="relative flex flex-col items-center justify-center bg-neutral-950 border border-white/10 rounded-2xl p-4 overflow-hidden shadow-inner">
          <canvas
            ref={canvasRef}
            className={`rounded-xl shadow-2xl border border-white/20 transition-all ${
              aspectMode === "square" ? "size-64 md:size-72 object-cover" : "w-full max-w-md aspect-video object-cover"
            }`}
          />
          <span className="text-[11px] text-muted-foreground mt-2">
            Kéo thanh trượt bên dưới để Phóng to / Di chuyển ảnh vừa vặn vào khung
          </span>
        </div>

        {/* Controls Panel */}
        <div className="space-y-4">
          {/* Mode Selector */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
              Khung hình
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAspectMode("square")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                  aspectMode === "square"
                    ? "border-primary bg-primary/20 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                🟩 Vuông (1:1 - Chuẩn Bìa Album)
              </button>
              <button
                type="button"
                onClick={() => setAspectMode("video")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                  aspectMode === "video"
                    ? "border-primary bg-primary/20 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                ▭ Ngang (16:9 - Chuẩn MV Wallpaper)
              </button>
            </div>
          </div>

          {/* Auto Black Bar Crop Button */}
          <button
            type="button"
            disabled={isProcessing}
            onClick={handleAutoCropBlackBars}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-all cursor-pointer"
          >
            <Sparkles className="size-4" />
            <span>Tự động nhận diện & Cắt sạch viền đen gốc</span>
          </button>

          {/* Zoom Slider */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <ZoomIn className="size-3.5" /> Phóng to / Thu nhỏ
              </span>
              <span className="font-mono text-primary">{zoom.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="w-full accent-primary cursor-pointer"
            />
          </div>

          {/* Position X Slider */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Move className="size-3.5" /> Vị trí Ngang (Trái / Phải)
              </span>
              <span className="font-mono text-muted-foreground">{offsetX}px</span>
            </div>
            <input
              type="range"
              min={-200}
              max={200}
              step={2}
              value={offsetX}
              onChange={(e) => setOffsetX(parseInt(e.target.value, 10))}
              className="w-full accent-primary cursor-pointer"
            />
          </div>

          {/* Position Y Slider */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Move className="size-3.5 rotate-90" /> Vị trí Dọc (Trên / Dưới)
              </span>
              <span className="font-mono text-muted-foreground">{offsetY}px</span>
            </div>
            <input
              type="range"
              min={-200}
              max={200}
              step={2}
              value={offsetY}
              onChange={(e) => setOffsetY(parseInt(e.target.value, 10))}
              className="w-full accent-primary cursor-pointer"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex gap-3 pt-3 border-t border-border">
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setOffsetX(0);
              setOffsetY(0);
            }}
            className="border border-border rounded-xl px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <RotateCcw className="size-3.5" /> Đặt lại
          </button>

          <button
            type="button"
            onClick={onClose}
            className="border border-border rounded-xl px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-1 cursor-pointer"
          >
            Hủy
          </button>

          <button
            type="button"
            onClick={handleSave}
            className="bg-primary text-primary-foreground font-semibold rounded-xl px-6 py-2.5 text-xs transition-transform hover:scale-[1.02] cursor-pointer flex items-center justify-center gap-2 flex-1"
          >
            <Check className="size-4" />
            <span>Áp dụng ảnh cắt</span>
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
