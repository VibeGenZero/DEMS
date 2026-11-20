/**
 * Escape hatch for custom plugin themes (`?design=standard` or
 * `#.../?design=standard`): disables `#custom-theme` before the first paint
 * and marks `<html>` with `data-design="standard"`.
 */
(function () {
    var search = typeof location === 'object' && location ? String(location.search || '') : '';
    var hash = typeof location === 'object' && location ? String(location.hash || '') : '';
    var hashQueryIndex = hash.indexOf('?');
    var hashQuery = hashQueryIndex >= 0 ? hash.slice(hashQueryIndex) : '';
    var pattern = /(?:^|[?&])design=standard(?:$|[&#])/;
    if (!pattern.test(search) && !pattern.test(hashQuery)) return;
    var link = document.getElementById('custom-theme');
    if (link) link.disabled = true;
    document.documentElement.setAttribute('data-design', 'standard');
})();
