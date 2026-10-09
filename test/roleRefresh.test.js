const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRoleRefresh } = require('../middleware/auth');

const MINUTE = 60 * 1000;
const ADMIN_ROLE = 'role-admin';
const MEMBER_ROLE = 'role-member';
const LOGIN = 1_000_000;

/**
 * Middleware with a fake clock and a fake Discord answer.
 *
 * @param {Function} answer -> (userId) => { isMember, roleIds } | null | Promise thereof.
 * @returns {Object} -> `{ run(user, at), calls }`.
 */
function setup(answer) {
    let clock = LOGIN;
    const calls = [];
    const refresh = createRoleRefresh({
        fetchMemberRoleIds: async (userId) => { calls.push(userId); return answer(userId); },
        getAdminRoleId: () => ADMIN_ROLE,
        now: () => clock
    });
    const run = async (user, at) => {
        clock = at;
        const req = { session: { user } };
        await new Promise((resolve, reject) => refresh(req, {}, (err) => (err ? reject(err) : resolve())));
        return req.session.user;
    };
    return { run, calls };
}

const admin = () => ({ id: 'u1', isAdmin: true, roles: [ADMIN_ROLE, MEMBER_ROLE], rolesCheckedAt: LOGIN });

test('a revoked admin role takes effect within five minutes', async () => {
    const { run, calls } = setup(() => ({ isMember: true, roleIds: [MEMBER_ROLE] }));

    const early = await run(admin(), LOGIN + 4 * MINUTE);
    assert.equal(early.isAdmin, true, 'no Discord call inside the interval');
    assert.equal(calls.length, 0);

    const later = await run(admin(), LOGIN + 6 * MINUTE);
    assert.equal(later.isAdmin, false);
    assert.deepEqual(later.roles, [MEMBER_ROLE]);
    assert.equal(later.rolesCheckedAt, LOGIN + 6 * MINUTE);
    assert.deepEqual(calls, ['u1']);
});

test('a new admin role takes effect as well', async () => {
    const { run } = setup(() => ({ isMember: true, roleIds: [MEMBER_ROLE, ADMIN_ROLE] }));
    const user = await run({ id: 'u2', isAdmin: false, roles: [MEMBER_ROLE], rolesCheckedAt: LOGIN }, LOGIN + 6 * MINUTE);
    assert.equal(user.isAdmin, true);
});

test('a member who left the server keeps no roles and no admin right', async () => {
    const { run } = setup(() => ({ isMember: false, roleIds: [] }));
    const user = await run(admin(), LOGIN + 6 * MINUTE);
    assert.equal(user.isAdmin, false);
    assert.deepEqual(user.roles, []);
});

test('sessions from before this check are checked on their next request', async () => {
    const { run, calls } = setup(() => ({ isMember: true, roleIds: [MEMBER_ROLE] }));
    const { rolesCheckedAt, ...legacy } = admin();
    assert.equal((await run(legacy, LOGIN + 1000)).isAdmin, false);
    assert.equal(calls.length, 1);
});

test('when Discord cannot answer the rights stay and the check is retried a minute later', async () => {
    let reachable = false;
    const { run, calls } = setup(() => (reachable ? { isMember: true, roleIds: [MEMBER_ROLE] } : null));
    const user = admin();

    await run(user, LOGIN + 6 * MINUTE);
    assert.equal(user.isAdmin, true, 'a bot outage must not lock admins out');
    await run(user, LOGIN + 6 * MINUTE + 30 * 1000);
    assert.equal(calls.length, 1, 'no new attempt within a minute');

    reachable = true;
    await run(user, LOGIN + 7 * MINUTE + 1000);
    assert.equal(calls.length, 2);
    assert.equal(user.isAdmin, false);
});

test('a failing Discord lookup counts as unreachable', async () => {
    const { run } = setup(() => { throw new Error('Discord down'); });
    assert.equal((await run(admin(), LOGIN + 6 * MINUTE)).isAdmin, true);
});

test('parallel requests of one user share one Discord lookup', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { run, calls } = setup(() => gate.then(() => ({ isMember: true, roleIds: [MEMBER_ROLE] })));

    const pending = [run(admin(), LOGIN + 6 * MINUTE), run(admin(), LOGIN + 6 * MINUTE)];
    release();
    const users = await Promise.all(pending);
    assert.equal(calls.length, 1);
    assert.deepEqual(users.map(user => user.isAdmin), [false, false]);
});

test('requests without a login pass untouched', async () => {
    const { calls } = setup(() => ({ isMember: true, roleIds: [] }));
    const refresh = createRoleRefresh({ fetchMemberRoleIds: async () => { calls.push('x'); return null; } });
    await new Promise(resolve => refresh({ session: {} }, {}, resolve));
    assert.equal(calls.length, 0);
});
