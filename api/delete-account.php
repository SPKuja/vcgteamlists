<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('POST');
require_csrf();

$user = require_user();
$body = json_body(4000);
if (trim((string) ($body['confirmation'] ?? '')) !== 'DELETE') {
    json_response(['error' => 'Type DELETE exactly to confirm account deletion.'], 422);
}

$userId = (int) $user['id'];
$avatar = !empty($user['avatar_file']) ? basename((string) $user['avatar_file']) : null;
$emailDigest = email_hash((string) $user['email']);

$pdo = db();
$pdo->beginTransaction();
try {
    $pdo->prepare('DELETE FROM auth_attempts WHERE email_hash = ?')->execute([$emailDigest]);
    $stmt = $pdo->prepare('DELETE FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    if ($stmt->rowCount() !== 1) throw new RuntimeException('Account could not be deleted.');
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    throw $e;
}

if ($avatar) {
    $path = rtrim((string) config('data_dir'), '/') . '/avatars/' . $avatar;
    if (is_file($path)) @unlink($path);
}

$_SESSION = [];
session_destroy();

json_response(['ok' => true]);
