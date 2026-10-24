const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp, isHidden } = require('./helpers');

const ADMIN = { id: 'u-admin', username: 'admin', roles: [], isAdmin: true };
const UPLOADED = '/uploads/banners/0f8fad5b-d9cb-469f-a165-70867728950e.png';
const MB = 1024 * 1024;
const file = (fields = {}) => ({ name: 'banner.png', type: 'image/png', size: 300 * 1024, ...fields });

/** Wizard with the create dialog open; `routes` add answers of the fake server. */
async function openWizard(routes = {}) {
    const frontend = await loadFrontendApp({ '/api/admin/roles': [], ...routes });
    frontend.state.currentUser = ADMIN;
    frontend.state.csrfToken = 'csrf-123';
    await frontend.app.showCreateEventModal();
    return frontend;
}

const uploads = (requests) => requests.filter(request => request.url === '/api/admin/uploads/banner');

test('a file that is too large or no allowed image is refused in the browser', async () => {
    const { app, toasts, requests, element } = await openWizard();
    await app.uploadBannerFile(file({ size: 7 * MB }));
    await app.uploadBannerFile(file({ type: 'image/svg+xml', name: 'logo.svg' }));
    assert.deepEqual(toasts, ['Das Bild darf höchstens 5 MB groß sein.', 'Nur PNG-, JPEG-, WebP- oder GIF-Bilder sind erlaubt.']);
    assert.deepEqual(uploads(requests), []);
    assert.equal(element('event-banner-url').value, '');
});

test('a valid file is uploaded raw and its path becomes the banner', async () => {
    const { app, requests, element, toasts } = await openWizard({ '/api/admin/uploads/banner': { bannerUrl: UPLOADED } });
    const picked = file();
    await app.uploadBannerFile(picked);

    const [request] = uploads(requests);
    assert.equal(request.method, 'POST');
    assert.equal(request.body, picked);
    assert.equal(request.headers['Content-Type'], 'image/png');
    assert.equal(request.headers['X-CSRF-TOKEN'], 'csrf-123');
    assert.equal(element('event-banner-url').value, UPLOADED);
    assert.equal(element('banner-preview').src, UPLOADED);
    assert.equal(isHidden(element('banner-preview-container')), false);
    assert.equal(isHidden(element('event-banner-clear')), false);
    assert.equal(element('event-banner-upload').disabled, false, 'button usable again');
    assert.deepEqual(toasts, ['Banner hochgeladen.']);
});

test('removing the banner clears the field and hides the preview', async () => {
    const { app, element } = await openWizard({ '/api/admin/uploads/banner': { bannerUrl: UPLOADED } });
    await app.uploadBannerFile(file());
    app.clearBanner();
    assert.equal(element('event-banner-url').value, '');
    assert.equal(isHidden(element('banner-preview-container')), true);
    assert.equal(isHidden(element('event-banner-clear')), true);
});

test('a refused upload shows the server message and keeps the field', async () => {
    // No route -> the fake server answers 404 { error: 'Nicht gefunden' }
    const { app, element, toasts } = await openWizard();
    element('event-banner-url').value = 'https://example.com/old.png';
    await app.uploadBannerFile(file());
    assert.deepEqual(toasts, ['Nicht gefunden']);
    assert.equal(element('event-banner-url').value, 'https://example.com/old.png');
    assert.equal(element('event-banner-upload').disabled, false);
});

test('a new event starts without banner, preview and remove button', async () => {
    const { element } = await openWizard();
    assert.equal(isHidden(element('banner-preview-container')), true);
    assert.equal(isHidden(element('event-banner-clear')), true);
    assert.ok(element('event-banner-file'), 'hidden file input exists');
});
