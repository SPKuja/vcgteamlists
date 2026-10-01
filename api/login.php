<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('POST');
require_csrf();

$body = json_body(20000);
$email = normalize_email((string) ($body['email'] ?? ''));
$password = (string) ($body['password'] ?? '');

if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $password === '') {
    json_response(['error' => 'Email or password is incorrect.'], 401);
}
if (rate_limited('login', $email, 8, 900)) {
    json_response(['error' => 'Too many sign-in attempts. Try again in 15 minutes.'], 429);
}

$stmt = db()->prepare('SELECT * FROM users WHERE email = ? LIMIT 1');
$stmt->execute([$email]);
$user = $stmt->fetch();

if (!$user || !password_verify($password, (string) $user['password_hash'])) {
    record_attempt('login', $email, false);
    usleep(random_int(120000, 260000));
    json_response(['error' => 'Email or password is incorrect.'], 401);
}

if (empty($user['email_verified_at'])) {
    record_attempt('login', $email, false);
    json_response([
        'error' => 'Verify your email before signing in.',
        'code' => 'email_not_verified'
    ], 403);
}

if (password_needs_rehash((string) $user['password_hash'], password_algorithm())) {
    $newHash = password_hash($password, password_algorithm());
    if (is_string($newHash)) {
        db()->prepare('UPDATE users SET password_hash = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')
            ->execute([$newHash, (int) $user['id']]);
        $user['password_hash'] = $newHash;
    }
}

session_regenerate_id(true);
$_SESSION['user_id'] = (int) $user['id'];
$_SESSION['session_version'] = (int) $user['session_version'];
$_SESSION['auth_time'] = time();
$_SESSION['csrf'] = bin2hex(random_bytes(32));

record_attempt('login', $email, true);

json_response([
    'ok' => true,
    'csrf' => csrf_token(),
    'user' => user_payload($user),
]);
