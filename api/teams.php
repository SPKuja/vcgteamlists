<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('GET', 'POST', 'DELETE');

$user = require_user();
$userId = (int) $user['id'];
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

if ($method === 'GET') {
    $stmt = db()->prepare(
        'SELECT id, name, game, payload, created_at, updated_at
         FROM teams WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 100'
    );
    $stmt->execute([$userId]);
    $teams = [];
    foreach ($stmt->fetchAll() as $row) {
        $payload = json_decode((string) $row['payload'], true);
        if (!is_array($payload)) $payload = [];
        $teams[] = [
            'id' => (int) $row['id'],
            'name' => (string) $row['name'],
            'game' => (string) $row['game'],
            'payload' => $payload,
            'createdAt' => (string) $row['created_at'],
            'updatedAt' => (string) $row['updated_at'],
        ];
    }
    json_response(['teams' => $teams]);
}

require_csrf();

if ($method === 'DELETE') {
    $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
    if (!$id) json_response(['error' => 'Team not found.'], 404);

    $stmt = db()->prepare('DELETE FROM teams WHERE id = ? AND user_id = ?');
    $stmt->execute([(int) $id, $userId]);
    if ($stmt->rowCount() < 1) json_response(['error' => 'Team not found.'], 404);

    json_response(['ok' => true]);
}

$body = json_body(280000);
$id = isset($body['id']) ? (int) $body['id'] : 0;
$name = trim((string) ($body['name'] ?? ''));
$game = trim((string) ($body['game'] ?? ''));
$payload = $body['payload'] ?? null;

if ($name === '') $name = 'Untitled team';
if (mb_strlen($name) > 100) json_response(['error' => 'Team name is too long.'], 422);
if (!in_array($game, ['champions', 'sv', 'swsh', 'custom'], true)) {
    json_response(['error' => 'Unknown game preset.'], 422);
}
if (!is_array($payload)) json_response(['error' => 'Team data is invalid.'], 422);

$encoded = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
if (!is_string($encoded) || strlen($encoded) > 250000) {
    json_response(['error' => 'Team data is too large.'], 422);
}

if ($id > 0) {
    $stmt = db()->prepare(
        'UPDATE teams SET name = ?, game = ?, payload = ?, updated_at = UTC_TIMESTAMP()
         WHERE id = ? AND user_id = ?'
    );
    $stmt->execute([$name, $game, $encoded, $id, $userId]);
    if ($stmt->rowCount() < 1) {
        $check = db()->prepare('SELECT id FROM teams WHERE id = ? AND user_id = ?');
        $check->execute([$id, $userId]);
        if (!$check->fetch()) json_response(['error' => 'Team not found.'], 404);
    }
} else {
    $count = db()->prepare('SELECT COUNT(*) FROM teams WHERE user_id = ?');
    $count->execute([$userId]);
    if ((int) $count->fetchColumn() >= 100) {
        json_response(['error' => 'You have reached the 100-team limit.'], 409);
    }

    $stmt = db()->prepare(
        'INSERT INTO teams (user_id, name, game, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())'
    );
    $stmt->execute([$userId, $name, $game, $encoded]);
    $id = (int) db()->lastInsertId();
}

$stmt = db()->prepare('SELECT id, name, game, payload, created_at, updated_at FROM teams WHERE id = ? AND user_id = ?');
$stmt->execute([$id, $userId]);
$row = $stmt->fetch();

json_response([
    'ok' => true,
    'team' => [
        'id' => (int) $row['id'],
        'name' => (string) $row['name'],
        'game' => (string) $row['game'],
        'payload' => json_decode((string) $row['payload'], true) ?: [],
        'createdAt' => (string) $row['created_at'],
        'updatedAt' => (string) $row['updated_at'],
    ],
]);
