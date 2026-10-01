<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('POST');
require_csrf();

$body = json_body(10000);
$email = normalize_email((string) ($body['email'] ?? ''));

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    json_response(['ok' => true, 'message' => 'If the account needs verification, a new email has been sent.']);
}
if (rate_limited('verify', $email, 4, 3600)) {
    json_response(['error' => 'Please wait before requesting another email.'], 429);
}

$stmt = db()->prepare('SELECT * FROM users WHERE email = ? LIMIT 1');
$stmt->execute([$email]);
$user = $stmt->fetch();
record_attempt('verify', $email, true);

if ($user && empty($user['email_verified_at'])) {
    send_verification_email($user);
}

json_response(['ok' => true, 'message' => 'If the account needs verification, a new email has been sent.']);
