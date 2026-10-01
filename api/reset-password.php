<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('POST');
require_csrf();

$body = json_body(20000);
$token = strtolower(trim((string) ($body['token'] ?? '')));
$password = (string) ($body['password'] ?? '');

if (!preg_match('/^[a-f0-9]{64}$/', $token)) {
    json_response(['error' => 'This reset link is invalid or has expired.'], 422);
}
if ($message = validate_password($password)) {
    json_response(['error' => $message], 422);
}

$hash = hash('sha256', $token);
$stmt = db()->prepare(
    'SELECT t.id AS token_id, t.user_id, u.email
     FROM password_reset_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > UTC_TIMESTAMP()
     LIMIT 1'
);
$stmt->execute([$hash]);
$row = $stmt->fetch();

if (!$row) json_response(['error' => 'This reset link is invalid or has expired.'], 422);

if ($message = validate_password($password, (string) $row['email'])) {
    json_response(['error' => $message], 422);
}

$newHash = password_hash($password, password_algorithm());
if (!is_string($newHash)) throw new RuntimeException('Could not hash password.');

$pdo = db();
$pdo->beginTransaction();
try {
    $pdo->prepare(
        'UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = UTC_TIMESTAMP()
         WHERE id = ?'
    )->execute([$newHash, (int) $row['user_id']]);
    $pdo->prepare('UPDATE password_reset_tokens SET used_at = UTC_TIMESTAMP() WHERE id = ?')
        ->execute([(int) $row['token_id']]);
    $pdo->prepare('DELETE FROM password_reset_tokens WHERE user_id = ? AND id <> ?')
        ->execute([(int) $row['user_id'], (int) $row['token_id']]);
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

json_response(['ok' => true, 'message' => 'Password updated. You can sign in now.']);
