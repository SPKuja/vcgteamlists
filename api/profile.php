<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('GET', 'POST');

$user = require_user();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    json_response(['user' => user_payload($user)]);
}

require_csrf();
$body = json_body(30000);

$playerName = trim((string) ($body['playerName'] ?? ''));
$trainerName = trim((string) ($body['trainerName'] ?? ''));
$playerId = trim((string) ($body['playerId'] ?? ''));
$yearRaw = trim((string) ($body['yearOfBirth'] ?? ''));

if (mb_strlen($playerName) > 120) json_response(['error' => 'Player name is too long.'], 422);
if (mb_strlen($trainerName) > 80) json_response(['error' => 'Trainer name is too long.'], 422);
if (mb_strlen($playerId) > 32) json_response(['error' => 'Player ID is too long.'], 422);

$year = null;
if ($yearRaw !== '') {
    if (!preg_match('/^\d{4}$/', $yearRaw)) json_response(['error' => 'Enter a four-digit year of birth.'], 422);
    $year = (int) $yearRaw;
    $currentYear = (int) gmdate('Y');
    if ($year < 1900 || $year > $currentYear) json_response(['error' => 'Enter a valid year of birth.'], 422);
}

$stmt = db()->prepare(
    'UPDATE users
     SET player_name = ?, trainer_name = ?, player_id = ?, year_of_birth = ?, updated_at = UTC_TIMESTAMP()
     WHERE id = ?'
);
$stmt->execute([
    $playerName !== '' ? $playerName : null,
    $trainerName !== '' ? $trainerName : null,
    $playerId !== '' ? $playerId : null,
    $year,
    (int) $user['id'],
]);

$stmt = db()->prepare('SELECT * FROM users WHERE id = ?');
$stmt->execute([(int) $user['id']]);
$updated = $stmt->fetch();

json_response(['ok' => true, 'user' => user_payload($updated)]);
