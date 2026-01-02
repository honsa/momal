<?php

declare(strict_types=1);

require __DIR__ . '/../../vendor/autoload.php';

use Momal\Domain\HighscoreStore;

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

$store = new HighscoreStore(__DIR__ . '/../../var/highscore.json');
$limit = (int)($_GET['limit'] ?? 20);
$limit = max(1, min(100, $limit));

echo json_encode([
    'top' => $store->top($limit),
], JSON_UNESCAPED_UNICODE);
