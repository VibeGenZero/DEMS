/**
 * Banner of the event wizard (W-12): upload an image file or enter a URL,
 * preview it, remove it. The server checks again (utils/bannerStore.js:
 * type by content, at most 5 MB) and answers with the stored path.
 */
import { state } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { showToast, toggleElement } from '../core/ui.js';

export const BANNER_MAX_BYTES = 5 * 1024 * 1024;
export const BANNER_FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const UPLOAD_LABEL = '<i class="bi bi-upload me-1"></i>Bild hochladen';
const BUSY_LABEL = '<i class="bi bi-hourglass-split me-1"></i>Lädt hoch…';

/**
 * Why a picked file cannot be a banner (same sentences as the server).
 *
 * @param {File} file -> Picked file.
 * @returns {string|null} -> German message, or null when the file may be uploaded.
 */
export function bannerFileProblem(file) {
    if (!file) return 'Keine Bilddatei ausgewählt.';
    if (!BANNER_FILE_TYPES.includes(file.type)) return 'Nur PNG-, JPEG-, WebP- oder GIF-Bilder sind erlaubt.';
    if (file.size > BANNER_MAX_BYTES) return 'Das Bild darf höchstens 5 MB groß sein.';
    return null;
}

/** Show the preview and the remove button while the banner field has a value. */
export function updateBannerPreview() {
    const url = document.getElementById('event-banner-url').value.trim();
    const img = document.getElementById('banner-preview');
    img.src = url;
    toggleElement(document.getElementById('banner-preview-container'), Boolean(url));
    toggleElement(document.getElementById('event-banner-clear'), Boolean(url));
}

function setUploadBusy(busy) {
    const button = document.getElementById('event-banner-upload');
    button.disabled = busy;
    button.innerHTML = busy ? BUSY_LABEL : UPLOAD_LABEL;
}

/**
 * Check and upload a picked file; on success its path becomes the banner.
 *
 * @param {File} file -> Picked file.
 * @returns {Promise<void>}
 */
export async function uploadBannerFile(file) {
    const problem = bannerFileProblem(file);
    if (problem) {
        showToast(problem, 'danger');
        return;
    }
    setUploadBusy(true);
    try {
        const res = await fetch('/api/admin/uploads/banner', {
            method: 'POST',
            headers: { 'Content-Type': file.type, 'X-CSRF-TOKEN': state.csrfToken },
            body: file
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.bannerUrl) {
            showToast(data.error || 'Fehler beim Hochladen des Banners.', 'danger');
            return;
        }
        document.getElementById('event-banner-url').value = data.bannerUrl;
        updateBannerPreview();
        showToast('Banner hochgeladen.', 'success');
    } catch (err) {
        console.error('Banner upload failed:', err);
        showToast('Fehler beim Hochladen des Banners.', 'danger');
    } finally {
        setUploadBusy(false);
    }
}

/** Remove the banner (URL or upload) from the form; the server deletes an unused file on save. */
export function clearBanner() {
    document.getElementById('event-banner-url').value = '';
    updateBannerPreview();
}

registerActions({
    pickBannerFile: () => document.getElementById('event-banner-file').click(),
    uploadBanner: (el) => {
        const [file] = el.files || [];
        // Reset, so picking the same file again fires change again
        el.value = '';
        return uploadBannerFile(file);
    },
    clearBanner: () => clearBanner(),
    updateBannerPreview: () => updateBannerPreview()
});
