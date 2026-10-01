<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('GET');

$token = (string) ($_GET['token'] ?? '');
if (!preg_match('/^[a-f0-9]{64}$/', $token)) {
    header('Location: ' . base_url() . '/?verified=invalid');
    exit;
}

$hash = hash('sha256', $token);
$stmt = db()->prepare(
    'SELECT t.id AS token_id, t.user_id
     FROM email_verification_tokens t
     WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > UTC_TIMESTAMP()
     LIMIT 1'
);
$stmt->execute([$hash]);
$row = $stmt->fetch();

if (!$row) {
    header('Location: ' . base_url() . '/?verified=invalid');
    exit;
}

$pdo = db();
$pdo->beginTransaction();
try {
    $pdo->prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()), updated_at = UTC_TIMESTAMP() WHERE id = ?')
        ->execute([(int) $row['user_id']]);
    $pdo->prepare('UPDATE email_verification_tokens SET used_at = UTC_TIMESTAMP() WHERE id = ?')
        ->execute([(int) $row['token_id']]);
    $pdo->prepare('DELETE FROM email_verification_tokens WHERE user_id = ? AND id <> ?')
        ->execute([(int) $row['user_id'], (int) $row['token_id']]);
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}

header('Location: ' . base_url() . '/?verified=1');
exit;
