<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('GET', 'POST', 'DELETE');

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

if ($method === 'GET') {
    $token = trim((string) ($_GET['token'] ?? ''));
    if ($token === '' || strlen($token) > 200) {
        json_response(['error' => 'Shared team not found.'], 404);
    }

    $hash = hash('sha256', $token);
    $stmt = db()->prepare(
        'SELECT t.name, t.game, t.payload, t.updated_at
         FROM team_shares s
         INNER JOIN teams t ON t.id = s.team_id
         WHERE s.token_hash = ?
         LIMIT 1'
    );
    $stmt->execute([$hash]);
    $row = $stmt->fetch();
    if (!$row) json_response(['error' => 'This shared team link is no longer available.'], 404);

    $payload = json_decode((string) $row['payload'], true);
    if (!is_array($payload)) $payload = [];
    unset($payload['meta']);

    json_response([
        'team' => [
            'name' => (string) $row['name'],
            'game' => (string) $row['game'],
            'payload' => $payload,
            'updatedAt' => (string) $row['updated_at'],
        ],
    ]);
}

require_csrf();
$user = require_user();
$userId = (int) $user['id'];

if ($method === 'DELETE') {
    $teamId = filter_input(INPUT_GET, 'teamId', FILTER_VALIDATE_INT);
    if (!$teamId) json_response(['error' => 'Team not found.'], 404);

    $stmt = db()->prepare(
        'DELETE s FROM team_shares s
         INNER JOIN teams t ON t.id = s.team_id
         WHERE s.team_id = ? AND t.user_id = ?'
    );
    $stmt->execute([(int) $teamId, $userId]);
    json_response(['ok' => true]);
}

$body = json_body(8000);
$teamId = (int) ($body['teamId'] ?? 0);
if ($teamId < 1) json_response(['error' => 'Team not found.'], 404);

$check = db()->prepare('SELECT id FROM teams WHERE id = ? AND user_id = ? LIMIT 1');
$check->execute([$teamId, $userId]);
if (!$check->fetch()) json_response(['error' => 'Team not found.'], 404);

$token = rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
$hash = hash('sha256', $token);

$stmt = db()->prepare(
    'INSERT INTO team_shares (team_id, token_hash, created_at, updated_at)
     VALUES (?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE token_hash = VALUES(token_hash), updated_at = UTC_TIMESTAMP()'
);
$stmt->execute([$teamId, $hash]);

json_response([
    'ok' => true,
    'url' => base_url() . '/shared/?token=' . rawurlencode($token),
]);
