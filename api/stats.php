<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('GET');

if (PHP_SAPI !== 'cli') {
    header('Cache-Control: public, max-age=300, stale-while-revalidate=300');
}

$pdo = db();

$registeredUsers = (int) $pdo->query(
    'SELECT COUNT(*) FROM users WHERE email_verified_at IS NOT NULL'
)->fetchColumn();

$newUsers30d = (int) $pdo->query(
    'SELECT COUNT(*) FROM users
     WHERE email_verified_at IS NOT NULL
       AND created_at >= (UTC_TIMESTAMP() - INTERVAL 30 DAY)'
)->fetchColumn();

$savedTeams = (int) $pdo->query(
    'SELECT COUNT(*) FROM teams t
     INNER JOIN users u ON u.id = t.user_id
     WHERE u.email_verified_at IS NOT NULL'
)->fetchColumn();

$teams30d = (int) $pdo->query(
    'SELECT COUNT(*) FROM teams t
     INNER JOIN users u ON u.id = t.user_id
     WHERE u.email_verified_at IS NOT NULL
       AND t.created_at >= (UTC_TIMESTAMP() - INTERVAL 30 DAY)'
)->fetchColumn();

$rows = $pdo->query(
    'SELECT t.game, t.payload
     FROM teams t
     INNER JOIN users u ON u.id = t.user_id
     WHERE u.email_verified_at IS NOT NULL'
)->fetchAll();

$gameCounts = ['champions' => 0, 'sv' => 0, 'swsh' => 0, 'custom' => 0];
$pokemonCounts = [];
$itemCounts = [];
$abilityCounts = [];
$alignmentCounts = [];
$totalPokemon = 0;

function increment_stat(array &$bucket, string $key, array $extra = []): void {
    $key = trim($key);
    if ($key === '') return;
    if (!isset($bucket[$key])) {
        $bucket[$key] = array_merge(['count' => 0], $extra);
    }
    $bucket[$key]['count']++;
    foreach ($extra as $field => $value) {
        if (($bucket[$key][$field] ?? '') === '' && $value !== '') {
            $bucket[$key][$field] = $value;
        }
    }
}

foreach ($rows as $row) {
    $game = (string) ($row['game'] ?? '');
    if (isset($gameCounts[$game])) $gameCounts[$game]++;

    $payload = json_decode((string) ($row['payload'] ?? ''), true);
    if (!is_array($payload) || !isset($payload['team']) || !is_array($payload['team'])) continue;

    foreach (array_slice($payload['team'], 0, 6) as $mon) {
        if (!is_array($mon)) continue;
        $name = trim((string) ($mon['name'] ?? ''));
        if ($name === '') continue;

        $totalPokemon++;
        $form = trim((string) ($mon['form'] ?? ''));
        $display = ($form !== '' && strcasecmp($form, 'Standard') !== 0)
            ? $name . ' — ' . $form
            : $name;
        $slug = trim((string) ($mon['slug'] ?? $mon['speciesSlug'] ?? ''));
        $pokemonKey = strtolower($slug !== '' ? $slug : $display);

        increment_stat($pokemonCounts, $pokemonKey, [
            'name' => $display,
            'image' => trim((string) ($mon['image'] ?? '')),
        ]);
        increment_stat($itemCounts, trim((string) ($mon['item'] ?? '')), [
            'image' => trim((string) ($mon['itemImage'] ?? '')),
        ]);
        increment_stat($abilityCounts, trim((string) ($mon['ability'] ?? '')));
        increment_stat($alignmentCounts, trim((string) ($mon['alignment'] ?? '')));
    }
}

$sortCounts = static function (array $a, array $b): int {
    $byCount = ((int) ($b['count'] ?? 0)) <=> ((int) ($a['count'] ?? 0));
    if ($byCount !== 0) return $byCount;
    return strcasecmp((string) ($a['name'] ?? ''), (string) ($b['name'] ?? ''));
};

$pokemon = array_values($pokemonCounts);
usort($pokemon, $sortCounts);
$pokemon = array_slice($pokemon, 0, 8);

$toRanked = static function (array $bucket, int $limit): array {
    $out = [];
    foreach ($bucket as $name => $data) {
        $out[] = [
            'name' => (string) $name,
            'count' => (int) ($data['count'] ?? 0),
            'image' => (string) ($data['image'] ?? ''),
        ];
    }
    usort($out, static function (array $a, array $b): int {
        $byCount = $b['count'] <=> $a['count'];
        return $byCount !== 0 ? $byCount : strcasecmp($a['name'], $b['name']);
    });
    return array_slice($out, 0, $limit);
};

$popularPokemon = array_map(static function (array $row): array {
    return [
        'name' => (string) ($row['name'] ?? ''),
        'count' => (int) ($row['count'] ?? 0),
        'image' => (string) ($row['image'] ?? ''),
    ];
}, $pokemon);

$gameBreakdown = [];
foreach ($gameCounts as $game => $count) {
    $gameBreakdown[] = ['game' => $game, 'count' => $count];
}
usort($gameBreakdown, static fn(array $a, array $b): int => $b['count'] <=> $a['count']);

json_response([
    'generatedAt' => gmdate(DATE_ATOM),
    'overview' => [
        'registeredUsers' => $registeredUsers,
        'savedTeams' => $savedTeams,
        'pokemonSlots' => $totalPokemon,
        'uniquePokemon' => count($pokemonCounts),
        'averageTeamSize' => $savedTeams > 0 ? round($totalPokemon / $savedTeams, 1) : 0,
        'newUsers30d' => $newUsers30d,
        'newTeams30d' => $teams30d,
    ],
    'popularPokemon' => $popularPokemon,
    'gameBreakdown' => $gameBreakdown,
    'popularItems' => $toRanked($itemCounts, 6),
    'popularAbilities' => $toRanked($abilityCounts, 6),
    'popularAlignments' => $toRanked($alignmentCounts, 6),
]);
