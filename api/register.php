<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('POST');
require_csrf();

$body = json_body(20000);
$email = normalize_email((string) ($body['email'] ?? ''));
$password = (string) ($body['password'] ?? '');

if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
    json_response(['error' => 'Enter a valid email address.'], 422);
}
if ($message = validate_password($password, $email)) {
    json_response(['error' => $message], 422);
}
if (rate_limited('register', $email, 5, 3600)) {
    json_response(['error' => 'Too many attempts. Try again later.'], 429);
}

$stmt = db()->prepare('SELECT id, email, email_verified_at FROM users WHERE email = ? LIMIT 1');
$stmt->execute([$email]);
$existing = $stmt->fetch();

if ($existing) {
    record_attempt('register', $email, false);
    if (empty($existing['email_verified_at'])) {
        send_verification_email($existing);
    }
    json_response([
        'ok' => true,
        'message' => 'If this email can be registered, a verification message has been sent.'
    ]);
}

$hash = password_hash($password, password_algorithm());
if (!is_string($hash)) throw new RuntimeException('Could not hash password.');

$stmt = db()->prepare(
    'INSERT INTO users (email, password_hash, created_at, updated_at)
     VALUES (?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())'
);
$stmt->execute([$email, $hash]);
$userId = (int) db()->lastInsertId();

$stmt = db()->prepare('SELECT * FROM users WHERE id = ?');
$stmt->execute([$userId]);
$user = $stmt->fetch();
if (!$user) throw new RuntimeException('New user could not be loaded.');

record_attempt('register', $email, true);
$sent = send_verification_email($user);

json_response([
    'ok' => true,
    'message' => $sent
        ? 'Account created. Check your email to verify it before signing in.'
        : 'Account created, but the verification email could not be sent. Use resend verification to try again.',
], 201);
