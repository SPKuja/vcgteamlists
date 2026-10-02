<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('GET', 'POST', 'DELETE');

$user = require_user();
$userId = (int) $user['id'];
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

if ($method === 'GET') {
    $stmt = db()->prepare(
        'SELECT id, name, format, payload, created_at, updated_at
         FROM decks
         WHERE user_id = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT 100'
    );
    $stmt->execute([$userId]);
    $decks = [];
    foreach ($stmt->fetchAll() as $row) {
        $payload = json_decode((string) $row['payload'], true);
        if (!is_array($payload)) $payload = [];
        $decks[] = [
            'id' => (int) $row['id'],
            'name' => (string) $row['name'],
            'format' => (string) $row['format'],
            'payload' => $payload,
            'createdAt' => (string) $row['created_at'],
            'updatedAt' => (string) $row['updated_at'],
        ];
    }
    json_response(['decks' => $decks]);
}

require_csrf();

if ($method === 'DELETE') {
    $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
    if (!$id) json_response(['error' => 'Deck not found.'], 404);

    $stmt = db()->prepare('DELETE FROM decks WHERE id = ? AND user_id = ?');
    $stmt->execute([(int) $id, $userId]);
    if ($stmt->rowCount() < 1) json_response(['error' => 'Deck not found.'], 404);

    json_response(['ok' => true]);
}

$body = json_body(360000);
$id = isset($body['id']) ? (int) $body['id'] : 0;
$name = trim((string) ($body['name'] ?? ''));
$format = strtolower(trim((string) ($body['format'] ?? 'standard')));
$payload = $body['payload'] ?? null;

if ($name === '') $name = 'Untitled deck';
if (mb_strlen($name) > 100) json_response(['error' => 'Deck name is too long.'], 422);
if (!in_array($format, ['standard', 'expanded', 'unlimited'], true)) {
    json_response(['error' => 'Unknown deck format.'], 422);
}
if (!is_array($payload)) json_response(['error' => 'Deck data is invalid.'], 422);

$cards = $payload['cards'] ?? null;
if (!is_array($cards)) json_response(['error' => 'Deck card data is invalid.'], 422);
if (count($cards) > 200) json_response(['error' => 'Deck contains too many unique card entries.'], 422);

$total = 0;
foreach ($cards as $card) {
    if (!is_array($card)) json_response(['error' => 'Deck card data is invalid.'], 422);
    $qty = (int) ($card['qty'] ?? 0);
    if ($qty < 1 || $qty > 60) json_response(['error' => 'Deck quantities are invalid.'], 422);
    $total += $qty;
}
if ($total > 60) json_response(['error' => 'A deck cannot contain more than 60 cards.'], 422);

$encoded = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
if (!is_string($encoded) || strlen($encoded) > 330000) {
    json_response(['error' => 'Deck data is too large.'], 422);
}

if ($id > 0) {
    $stmt = db()->prepare(
        'UPDATE decks SET name = ?, format = ?, payload = ?, updated_at = UTC_TIMESTAMP()
         WHERE id = ? AND user_id = ?'
    );
    $stmt->execute([$name, $format, $encoded, $id, $userId]);
    if ($stmt->rowCount() < 1) {
        $check = db()->prepare('SELECT id FROM decks WHERE id = ? AND user_id = ?');
        $check->execute([$id, $userId]);
        if (!$check->fetch()) json_response(['error' => 'Deck not found.'], 404);
    }
} else {
    $count = db()->prepare('SELECT COUNT(*) FROM decks WHERE user_id = ?');
    $count->execute([$userId]);
    if ((int) $count->fetchColumn() >= 100) {
        json_response(['error' => 'You have reached the 100-deck limit.'], 409);
    }

    $stmt = db()->prepare(
        'INSERT INTO decks (user_id, name, format, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())'
    );
    $stmt->execute([$userId, $name, $format, $encoded]);
    $id = (int) db()->lastInsertId();
}

$stmt = db()->prepare('SELECT id, name, format, payload, created_at, updated_at FROM decks WHERE id = ? AND user_id = ?');
$stmt->execute([$id, $userId]);
$row = $stmt->fetch();

json_response([
    'ok' => true,
    'deck' => [
        'id' => (int) $row['id'],
        'name' => (string) $row['name'],
        'format' => (string) $row['format'],
        'payload' => json_decode((string) $row['payload'], true) ?: [],
        'createdAt' => (string) $row['created_at'],
        'updatedAt' => (string) $row['updated_at'],
    ],
]);
