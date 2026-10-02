// iPhone で WebXR を使うための Variant Launch（https://launch.variant3d.com/）。
// ★<head> の中で、ほかのスクリプトより先に読むこと（document.write で SDK を差し込むため）。
// キーが空なら Android（ARCore 対応機）だけで動く。
// redirect は付けない：iPhone でもまず説明と平面図を見せ、「AR を始める」で Launch へ移る
const VL_KEY = 'WKLOEbI0zNM5TK7uuvXyySVCYLN7zf3k';
window.__vl = null;
window.addEventListener('vlaunch-initialized', e => { window.__vl = e.detail; });
// SDK を読むと Android・PC でも launch として数えられる（2026-09-30 に確認）。
// Android は Chrome の WebXR で足りるので、iPhone・iPad のときだけ読む。iPhone は 1 回開くと 3 数えられる
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (VL_KEY && IS_IOS) document.write('<script src="https://launchar.app/sdk/v1?key=' + VL_KEY + '"><\/script>');
