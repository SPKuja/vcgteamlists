<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

if ($method === 'GET') {
    $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
    if (!$id) {
        http_response_code(404);
        exit;
    }

    $stmt = db()->prepare('SELECT id, email, avatar_mode, avatar_file, updated_at FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([(int) $id]);
    $user = $stmt->fetch();
    if (!$user) {
        http_response_code(404);
        exit;
    }

    if (($user['avatar_mode'] ?? 'gravatar') !== 'custom' || empty($user['avatar_file'])) {
        $hash = md5(normalize_email((string) $user['email']));
        header('Location: https://www.gravatar.com/avatar/' . $hash . '?s=160&d=identicon&r=pg', true, 302);
        exit;
    }

    $base = rtrim((string) config('data_dir'), '/') . '/avatars/';
    $file = basename((string) $user['avatar_file']);
    $path = $base . $file;
    if (!is_file($path)) {
        http_response_code(404);
        exit;
    }

    header_remove('Content-Type');
    header('Content-Type: image/jpeg');
    header('Cache-Control: public, max-age=86400, immutable');
    header('X-Content-Type-Options: nosniff');
    readfile($path);
    exit;
}

if ($method === 'POST') {
    require_csrf();
    $user = require_user();

    if (!isset($_FILES['avatar']) || !is_uploaded_file($_FILES['avatar']['tmp_name'])) {
        json_response(['error' => 'Choose an image to upload.'], 422);
    }

    $file = $_FILES['avatar'];
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        json_response(['error' => 'Avatar upload failed.'], 422);
    }
    if ((int) ($file['size'] ?? 0) > 3 * 1024 * 1024) {
        json_response(['error' => 'Avatar must be smaller than 3 MB.'], 422);
    }

    $info = @getimagesize((string) $file['tmp_name']);
    if (!$info || ($info[0] ?? 0) < 1 || ($info[1] ?? 0) < 1 || $info[0] > 4096 || $info[1] > 4096) {
        json_response(['error' => 'Upload a valid image up to 4096×4096.'], 422);
    }

    if (!function_exists('imagecreatefromstring') || !function_exists('imagejpeg')) {
        json_response(['error' => 'Avatar processing is unavailable on the server.'], 503);
    }

    $bytes = file_get_contents((string) $file['tmp_name']);
    $source = $bytes !== false ? @imagecreatefromstring($bytes) : false;
    if (!$source) json_response(['error' => 'Upload a valid JPG, PNG or WebP image.'], 422);

    $width = imagesx($source);
    $height = imagesy($source);
    $side = min($width, $height);
    $srcX = (int) floor(($width - $side) / 2);
    $srcY = (int) floor(($height - $side) / 2);

    $target = imagecreatetruecolor(512, 512);
    if (!$target) {
        imagedestroy($source);
        json_response(['error' => 'Could not process avatar.'], 500);
    }
    imagecopyresampled($target, $source, 0, 0, $srcX, $srcY, 512, 512, $side, $side);

    $dir = rtrim((string) config('data_dir'), '/') . '/avatars';
    if (!is_dir($dir) && !mkdir($dir, 0700, true) && !is_dir($dir)) {
        imagedestroy($source);
        imagedestroy($target);
        throw new RuntimeException('Avatar directory could not be created.');
    }

    $name = bin2hex(random_bytes(20)) . '.jpg';
    $path = $dir . '/' . $name;
    if (!imagejpeg($target, $path, 90)) {
        imagedestroy($source);
        imagedestroy($target);
        throw new RuntimeException('Avatar could not be written.');
    }
    chmod($path, 0600);
    imagedestroy($source);
    imagedestroy($target);

    $old = !empty($user['avatar_file']) ? basename((string) $user['avatar_file']) : null;
    db()->prepare(
        "UPDATE users SET avatar_mode = 'custom', avatar_file = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?"
    )->execute([$name, (int) $user['id']]);

    if ($old && $old !== $name) {
        $oldPath = $dir . '/' . $old;
        if (is_file($oldPath)) @unlink($oldPath);
    }

    $stmt = db()->prepare('SELECT * FROM users WHERE id = ?');
    $stmt->execute([(int) $user['id']]);
    json_response(['ok' => true, 'user' => user_payload($stmt->fetch())]);
}

if ($method === 'DELETE') {
    require_csrf();
    $user = require_user();
    $dir = rtrim((string) config('data_dir'), '/') . '/avatars';
    $old = !empty($user['avatar_file']) ? basename((string) $user['avatar_file']) : null;

    db()->prepare(
        "UPDATE users SET avatar_mode = 'gravatar', avatar_file = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?"
    )->execute([(int) $user['id']]);

    if ($old) {
        $oldPath = $dir . '/' . $old;
        if (is_file($oldPath)) @unlink($oldPath);
    }

    $stmt = db()->prepare('SELECT * FROM users WHERE id = ?');
    $stmt->execute([(int) $user['id']]);
    json_response(['ok' => true, 'user' => user_payload($stmt->fetch())]);
}

header('Allow: GET, POST, DELETE');
json_response(['error' => 'Method not allowed.'], 405);
