/**
 * 持久化仓储服务。
 *
 * 为执行器提供统一的读写接口，避免业务代码直接操作 SQL。
 * 所有写入使用预处理语句，聚合查询以 cycle_id 为主线。
 */

function safeStringify(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

function parseJsonField(value) {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function createCycleRepository(adapter) {
  const insertStmt = adapter.prepare({
    sql: `INSERT INTO cycles
      (cycle_id, signal_id, symbol, mode, direction, status, started_at, ended_at, metadata_json)
      VALUES (@cycleId, @signalId, @symbol, @mode, @direction, @status, @startedAt, @endedAt, @metadataJson)`,
  });

  const findByIdStmt = adapter.prepare({
    sql: "SELECT * FROM cycles WHERE cycle_id = ?",
  });

  const updateStatusStmt = adapter.prepare({
    sql: "UPDATE cycles SET status = ?, ended_at = ? WHERE cycle_id = ?",
  });

  const findByTimeRangeStmt = adapter.prepare({
    sql: "SELECT * FROM cycles WHERE started_at >= ? AND started_at <= ? ORDER BY started_at",
  });

  return {
    insert({
      cycleId,
      signalId,
      symbol,
      mode,
      direction,
      status,
      startedAt,
      endedAt = null,
      metadata = null,
    } = {}) {
      insertStmt.run({
        cycleId,
        signalId,
        symbol,
        mode,
        direction,
        status,
        startedAt,
        endedAt,
        metadataJson: safeStringify(metadata),
      });
    },
    findById(cycleId) {
      return findByIdStmt.get(cycleId) ?? null;
    },
    updateStatus(cycleId, status, endedAt = null) {
      updateStatusStmt.run(status, endedAt, cycleId);
    },
    findByTimeRange(from, to) {
      return findByTimeRangeStmt.all(from, to);
    },
    findAll() {
      return adapter.prepare({ sql: "SELECT * FROM cycles ORDER BY started_at DESC" }).all();
    },
  };
}

export function createOrderRepository(adapter) {
  const insertStmt = adapter.prepare({
    sql: `INSERT INTO orders
      (order_id, cycle_id, exchange, leg, side, symbol, price, quantity, filled_quantity, status, raw_payload_json, created_at)
      VALUES (@orderId, @cycleId, @exchange, @leg, @side, @symbol, @price, @quantity, @filledQuantity, @status, @rawPayloadJson, @createdAt)`,
  });

  const findByCycleIdStmt = adapter.prepare({
    sql: "SELECT * FROM orders WHERE cycle_id = ? ORDER BY created_at",
  });

  return {
    insert(order) {
      insertStmt.run({
        orderId: order.orderId,
        cycleId: order.cycleId,
        exchange: order.exchange,
        leg: order.leg,
        side: order.side,
        symbol: order.symbol,
        price: order.price,
        quantity: order.quantity,
        filledQuantity: order.filledQuantity ?? 0,
        status: order.status,
        rawPayloadJson: safeStringify(order.rawPayload),
        createdAt: order.createdAt,
      });
    },
    insertMany(orders) {
      adapter.transaction(() => {
        for (const order of orders) {
          this.insert(order);
        }
      })();
    },
    findByCycleId(cycleId) {
      return findByCycleIdStmt.all(cycleId);
    },
    findById(orderId) {
      return adapter.prepare({ sql: "SELECT * FROM orders WHERE order_id = ?" }).get(orderId) ?? null;
    },
  };
}

export function createFillRepository(adapter) {
  const insertStmt = adapter.prepare({
    sql: `INSERT INTO fills
      (fill_id, order_id, cycle_id, exchange, symbol, side, price, quantity, fee_usdt, timestamp)
      VALUES (@fillId, @orderId, @cycleId, @exchange, @symbol, @side, @price, @quantity, @feeUsdt, @timestamp)`,
  });

  const findByOrderIdStmt = adapter.prepare({
    sql: "SELECT * FROM fills WHERE order_id = ? ORDER BY timestamp",
  });

  const findByCycleIdStmt = adapter.prepare({
    sql: "SELECT * FROM fills WHERE cycle_id = ? ORDER BY timestamp",
  });

  return {
    insert(fill) {
      insertStmt.run({
        fillId: fill.fillId,
        orderId: fill.orderId,
        cycleId: fill.cycleId,
        exchange: fill.exchange,
        symbol: fill.symbol,
        side: fill.side,
        price: fill.price,
        quantity: fill.quantity,
        feeUsdt: fill.feeUsdt ?? 0,
        timestamp: fill.timestamp,
      });
    },
    insertMany(fills) {
      adapter.transaction(() => {
        for (const fill of fills) {
          this.insert(fill);
        }
      })();
    },
    findByOrderId(orderId) {
      return findByOrderIdStmt.all(orderId);
    },
    findByCycleId(cycleId) {
      return findByCycleIdStmt.all(cycleId);
    },
  };
}

export function createPositionRepository(adapter) {
  const insertStmt = adapter.prepare({
    sql: `INSERT INTO positions
      (position_id, cycle_id, symbol, legs_json, entry_notional_usdt, mark_notional_usdt, unrealized_pnl_usdt, timestamp)
      VALUES (@positionId, @cycleId, @symbol, @legsJson, @entryNotionalUsdt, @markNotionalUsdt, @unrealizedPnlUsdt, @timestamp)`,
  });

  const findByCycleIdStmt = adapter.prepare({
    sql: "SELECT * FROM positions WHERE cycle_id = ? ORDER BY timestamp",
  });

  return {
    insert({
      positionId,
      cycleId,
      symbol,
      legs,
      entryNotionalUsdt,
      markNotionalUsdt,
      unrealizedPnlUsdt = 0,
      timestamp,
    } = {}) {
      insertStmt.run({
        positionId,
        cycleId,
        symbol,
        legsJson: safeStringify(legs),
        entryNotionalUsdt,
        markNotionalUsdt,
        unrealizedPnlUsdt,
        timestamp,
      });
    },
    findByCycleId(cycleId) {
      return findByCycleIdStmt.all(cycleId).map((row) => ({
        ...row,
        legs: parseJsonField(row.legs_json),
      }));
    },
  };
}

export function createSpreadLockRepository(adapter) {
  const insertStmt = adapter.prepare({
    sql: `INSERT INTO spread_locks
      (lock_id, cycle_id, symbol, gross_spread_usdt, fee_cost_usdt, net_spread_usdt, net_spread_bps, fx_detail_json, locked_at)
      VALUES (@lockId, @cycleId, @symbol, @grossSpreadUsdt, @feeCostUsdt, @netSpreadUsdt, @netSpreadBps, @fxDetailJson, @lockedAt)`,
  });

  const findByCycleIdStmt = adapter.prepare({
    sql: "SELECT * FROM spread_locks WHERE cycle_id = ?",
  });

  return {
    insert({
      lockId,
      cycleId,
      symbol,
      grossSpreadUsdt,
      feeCostUsdt = 0,
      netSpreadUsdt,
      netSpreadBps,
      fxDetail = null,
      lockedAt,
    } = {}) {
      insertStmt.run({
        lockId,
        cycleId,
        symbol,
        grossSpreadUsdt,
        feeCostUsdt,
        netSpreadUsdt,
        netSpreadBps,
        fxDetailJson: safeStringify(fxDetail),
        lockedAt,
      });
    },
    findByCycleId(cycleId) {
      const row = findByCycleIdStmt.get(cycleId);
      if (!row) {
        return null;
      }
      return {
        ...row,
        fx_detail: parseJsonField(row.fx_detail_json),
      };
    },
  };
}

export function createCloseResultRepository(adapter) {
  const insertStmt = adapter.prepare({
    sql: `INSERT INTO close_results
      (close_id, cycle_id, symbol, expected_spread_usdt, actual_spread_usdt, maker_slippage_usdt, taker_slippage_usdt, net_profit_usdt, closed_at, metadata_json)
      VALUES (@closeId, @cycleId, @symbol, @expectedSpreadUsdt, @actualSpreadUsdt, @makerSlippageUsdt, @takerSlippageUsdt, @netProfitUsdt, @closedAt, @metadataJson)`,
  });

  const findByCycleIdStmt = adapter.prepare({
    sql: "SELECT * FROM close_results WHERE cycle_id = ?",
  });

  return {
    insert({
      closeId,
      cycleId,
      symbol,
      expectedSpreadUsdt,
      actualSpreadUsdt,
      makerSlippageUsdt = 0,
      takerSlippageUsdt = 0,
      netProfitUsdt,
      closedAt,
      metadata = null,
    } = {}) {
      insertStmt.run({
        closeId,
        cycleId,
        symbol,
        expectedSpreadUsdt,
        actualSpreadUsdt,
        makerSlippageUsdt,
        takerSlippageUsdt,
        netProfitUsdt,
        closedAt,
        metadataJson: safeStringify(metadata),
      });
    },
    findByCycleId(cycleId) {
      const row = findByCycleIdStmt.get(cycleId);
      if (!row) {
        return null;
      }
      return {
        ...row,
        metadata: parseJsonField(row.metadata_json),
      };
    },
  };
}

export function createRiskEventRepository(adapter) {
  const insertStmt = adapter.prepare({
    sql: `INSERT INTO risk_events
      (risk_event_id, cycle_id, type, severity, symbol, plan_id, message, context_json, timestamp)
      VALUES (@riskEventId, @cycleId, @type, @severity, @symbol, @planId, @message, @contextJson, @timestamp)`,
  });

  const findByCycleIdStmt = adapter.prepare({
    sql: "SELECT * FROM risk_events WHERE cycle_id = ? ORDER BY timestamp",
  });

  return {
    insert({
      riskEventId,
      cycleId = null,
      type,
      severity,
      symbol = null,
      planId = null,
      message,
      context = null,
      timestamp,
    } = {}) {
      insertStmt.run({
        riskEventId,
        cycleId,
        type,
        severity,
        symbol,
        planId,
        message,
        contextJson: safeStringify(context),
        timestamp,
      });
    },
    findByCycleId(cycleId) {
      return findByCycleIdStmt.all(cycleId).map((row) => ({
        ...row,
        context: parseJsonField(row.context_json),
      }));
    },
  };
}

export function createRepositories(adapter) {
  const cycles = createCycleRepository(adapter);
  const orders = createOrderRepository(adapter);
  const fills = createFillRepository(adapter);
  const positions = createPositionRepository(adapter);
  const spreadLocks = createSpreadLockRepository(adapter);
  const closeResults = createCloseResultRepository(adapter);
  const riskEvents = createRiskEventRepository(adapter);

  return {
    cycles,
    orders,
    fills,
    positions,
    spreadLocks,
    closeResults,
    riskEvents,
    aggregateByCycleId(cycleId) {
      const cycle = cycles.findById(cycleId);
      if (!cycle) {
        return null;
      }

      return {
        cycle,
        orders: orders.findByCycleId(cycleId),
        fills: fills.findByCycleId(cycleId),
        positions: positions.findByCycleId(cycleId),
        spreadLock: spreadLocks.findByCycleId(cycleId),
        closeResult: closeResults.findByCycleId(cycleId),
        riskEvents: riskEvents.findByCycleId(cycleId),
      };
    },
  };
}
