// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { wadExp, wadMul, wadDiv } from "solmate/src/utils/SignedWadMath.sol";

library CompoundInterest {
    int256 private constant _YEAR_WAD = 365 days * 1e18;
    uint256 private constant _LIQUIDATION_THRESHOLD = 100_000;
    uint256 private constant _BASIS_POINTS = 10_000;

    function currentDebtAmount(
      uint256 timestamp,
      uint256 principal,
      uint256 startTime,
      uint256 duration,
      uint256 fee,
      uint256 rate,
      uint256 defaultRate
    ) public view returns (
        uint256 debt,
        uint256 feeInterest,
        uint256 lenderInterest
    ) {
        // compute debtWithFee
        uint256 debtWithFee = computeCurrentDebt(
            principal, 
            fee,
            startTime, 
            timestamp
        );

        // lien is past tenor
        uint256 debtWithRate;
        if (timestamp > startTime + duration) {
            debtWithRate = computeCurrentDebt(
                principal, 
                rate,
                startTime, 
                startTime + duration
            );

            debtWithRate = computeCurrentDebt(
                debtWithRate, 
                defaultRate, 
                startTime + duration, 
                timestamp
            );
        } else {
            debtWithRate = computeCurrentDebt(
                principal, 
                rate, 
                startTime, 
                timestamp
            );
        }

        feeInterest = debtWithFee - principal;
        lenderInterest = debtWithRate - principal;
        debt = principal + feeInterest + lenderInterest;
    }

    /**
     * @dev Computes the current debt of a borrow given the last time it was touched and the last computed debt.
     * @param amount Principal in ETH
     * @param startTime Start time of the loan
     * @param rate Interest rate (in bips)
     * @dev Formula: https://www.desmos.com/calculator/l6omp0rwnh
     */
    function computeCurrentDebt(
        uint256 amount,
        uint256 rate,
        uint256 startTime,
        uint256 endTime
    ) public pure returns (uint256) {
        uint256 loanTime = endTime - startTime;
        int256 yearsWad = wadDiv(int256(loanTime) * 1e18, _YEAR_WAD);
        return uint256(wadMul(int256(amount), wadExp(wadMul(yearsWad, bipsToSignedWads(rate)))));
    }

    /**
     * @dev Converts an integer bips value to a signed wad value.
     */
    function bipsToSignedWads(uint256 bips) public pure returns (int256) {
        return int256((bips * 1e18) / _BASIS_POINTS);
    }
}