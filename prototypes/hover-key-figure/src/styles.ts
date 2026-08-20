/* All CSS, carried inside the bundle.
 *
 * A published extension.css is only injected on the URL-loading path; under a
 * roam/js `import()` preview nothing injects it, so structural styles must
 * travel in the JS (copy-for-latex's lesson).
 *
 * Z-index: Roam's own popovers sit around 10–1000; Blueprint overlays at 20.
 * The chip and card sit above content but below the lightbox, which must beat
 * everything during a presentation.
 */
export const HKF_STYLE_ID = "hover-key-figure-style";

export const HKF_CSS = `
.hkf-chip {
  position: fixed;
  z-index: 10050;
  transform: translateY(-50%);
  display: none;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  color: #394b59;
  background: #f5f8fa;
  border: 1px solid rgba(16, 22, 26, 0.2);
  border-radius: 10px;
  box-shadow: 0 1px 3px rgba(16, 22, 26, 0.15);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.hkf-chip--visible { display: inline-flex; }
.hkf-chip:hover { background: #ebf1f5; }
.hkf-chip--empty { opacity: 0.55; cursor: default; }
.hkf-chip--empty:hover { background: #f5f8fa; }

.hkf-card {
  position: fixed;
  z-index: 10060;
  display: flex;
  flex-direction: column;
  max-width: min(480px, 90vw);
  max-height: 52vh;
  background: #ffffff;
  border: 1px solid rgba(16, 22, 26, 0.2);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(16, 22, 26, 0.25);
  overflow: hidden;
}
.hkf-card__body {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 240px;
  min-height: 96px;
  padding: 8px;
  overflow: hidden;
}
.hkf-card__img {
  display: block;
  max-width: 100%;
  max-height: calc(52vh - 46px);
  object-fit: contain;
  cursor: zoom-in;
  border-radius: 3px;
}
.hkf-card__caption {
  padding: 5px 10px;
  font-size: 11px;
  line-height: 15px;
  color: #5c7080;
  background: #f5f8fa;
  border-top: 1px solid rgba(16, 22, 26, 0.1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: none;
}
.hkf-card__message {
  padding: 12px 16px;
  font-size: 12px;
  color: #5c7080;
}
.hkf-card__spinner {
  width: 22px;
  height: 22px;
  border: 3px solid rgba(92, 112, 128, 0.25);
  border-top-color: #5c7080;
  border-radius: 50%;
  animation: hkf-spin 0.8s linear infinite;
}
@keyframes hkf-spin { to { transform: rotate(360deg); } }

.hkf-lightbox {
  position: fixed;
  inset: 0;
  z-index: 10100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(16, 22, 26, 0.85);
  cursor: zoom-out;
}
.hkf-lightbox__img {
  max-width: 92vw;
  max-height: 92vh;
  object-fit: contain;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
  border-radius: 4px;
  background: #ffffff;
}

.hkf-dark .hkf-chip,
.roam-body-main.hkf-dark .hkf-chip {
  color: #f5f8fa;
  background: #30404d;
  border-color: rgba(16, 22, 26, 0.6);
}
`;
