/**
 * Core reset-password prompt (`#passwordModal`) for plugin API calls with
 * `{ password: true }`. The plugin code never receives the password value.
 */

/**
 * Open the reset-password modal and resolve with the typed password, or `null`
 * when the admin cancels/dismisses the dialog.
 *
 * @param {string} message -> Explanation shown above the password input.
 * @returns {Promise<string|null>}
 */
export function showPasswordDialog(message) {
    return new Promise(resolve => {
        const modalEl = document.getElementById('passwordModal');
        const textEl = document.getElementById('password-modal-text');
        const inputEl = document.getElementById('password-modal-input');
        const okBtn = document.getElementById('password-modal-ok');
        textEl.textContent = message;
        inputEl.value = '';
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        let confirming = false;
        let answer = null;
        const submit = () => {
            const value = String(inputEl.value || '');
            if (!value) return;
            inputEl.value = '';
            confirming = true;
            answer = value;
            modal.hide();
            confirming = false;
        };
        const onHide = () => {
            if (!confirming) {
                inputEl.value = '';
                answer = null;
            }
        };
        const onKeydown = event => {
            if (event && event.key === 'Enter') {
                event.preventDefault?.();
                submit();
            }
        };
        okBtn.onclick = submit;
        inputEl.addEventListener('keydown', onKeydown);
        modalEl.addEventListener('hide.bs.modal', onHide);
        modalEl.addEventListener('hidden.bs.modal', () => {
            inputEl.removeEventListener('keydown', onKeydown);
            modalEl.removeEventListener('hide.bs.modal', onHide);
            resolve(answer);
        }, { once: true });
        modal.show();
    });
}
