<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('POST');
require_csrf();

$user = require_user();
$body = json_body(20000);
$action = trim((string) ($body['action'] ?? ''));
$currentPassword = (string) ($body['currentPassword'] ?? '');

if ($currentPassword === '' || !password_verify($currentPassword, (string) $user['password_hash'])) {
    json_response(['error' => 'Current password is incorrect.'], 422);
}

if ($action === 'password') {
    $newPassword = (string) ($body['newPassword'] ?? '');
    if ($message = validate_password($newPassword, (string) $user['email'])) {
        json_response(['error' => $message], 422);
    }
    if (password_verify($newPassword, (string) $user['password_hash'])) {
        json_response(['error' => 'Choose a different password.'], 422);
    }

    $hash = password_hash($newPassword, password_algorithm());
    if (!is_string($hash)) throw new RuntimeException('Could not hash password.');

    $newVersion = ((int) $user['session_version']) + 1;
    db()->prepare(
        'UPDATE users SET password_hash = ?, session_version = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?'
    )->execute([$hash, $newVersion, (int) $user['id']]);

    $_SESSION['session_version'] = $newVersion;
    session_regenerate_id(true);
    $_SESSION['csrf'] = bin2hex(random_bytes(32));

    $stmt = db()->prepare('SELECT * FROM users WHERE id = ?');
    $stmt->execute([(int) $user['id']]);
    $updated = $stmt->fetch();

    json_response([
        'ok' => true,
        'csrf' => csrf_token(),
        'user' => user_payload($updated),
        'message' => 'Password updated.',
    ]);
}

if ($action === 'email') {
    $email = normalize_email((string) ($body['email'] ?? ''));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
        json_response(['error' => 'Enter a valid email address.'], 422);
    }
    if ($email === normalize_email((string) $user['email'])) {
        json_response(['error' => 'That is already your account email.'], 422);
    }

    $check = db()->prepare('SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1');
    $check->execute([$email, (int) $user['id']]);
    if ($check->fetch()) {
        json_response(['error' => 'That email address is already in use.'], 409);
    }

    $newVersion = ((int) $user['session_version']) + 1;
    db()->prepare(
        'UPDATE users
         SET email = ?, email_verified_at = NULL, session_version = ?, updated_at = UTC_TIMESTAMP()
         WHERE id = ?'
    )->execute([$email, $newVersion, (int) $user['id']]);

    $stmt = db()->prepare('SELECT * FROM users WHERE id = ?');
    $stmt->execute([(int) $user['id']]);
    $updated = $stmt->fetch();
    if (!$updated) throw new RuntimeException('Updated account could not be loaded.');

    $sent = send_verification_email($updated);

    $_SESSION = [];
    session_destroy();

    json_response([
        'ok' => true,
        'message' => $sent
            ? 'Email updated. Check your new email for a verification link before signing in again.'
            : 'Email updated, but the verification email could not be sent. Use resend verification to try again.',
    ]);
}

json_response(['error' => 'Unknown account update.'], 422);
