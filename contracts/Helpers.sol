// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "solmate/src/utils/SignedWadMath.sol";

import { Lien } from "./Structs.sol";

library Helpers {
    int256 private constant _YEAR_WAD = 365 days * 1e18;
    uint256 private constant _LIQUIDATION_THRESHOLD = 100_000;
    uint256 private constant _BASIS_POINTS = 10_000;

    function interestPaymentBreakdown(Lien memory lien, uint256 amount) 
        public 
        view 
        returns (
            uint256 amountOwed,
            uint256 feeInterest, 
            uint256 lenderInterest, 
            uint256 principal
        ) 
    {
        (amountOwed, feeInterest, lenderInterest) = computeAmountOwed(lien);
        if (amount > feeInterest + lenderInterest) {
            principal = amount - feeInterest - lenderInterest;
        }
    }

    function computeAmountOwed(Lien memory lien)
        public 
        view 
        returns (
            uint256 amountOwed,
            uint256 feeInterest,
            uint256 lenderInterest
        ) 
    {

        uint256 amountWithFee = computeCurrentDebt(
            lien.state.amountOwed, 
            lien.fee,
            lien.state.lastPayment, 
            block.timestamp
        );

        // lien is past tenor
        if (block.timestamp > lien.startTime + lien.tenor) {
            uint256 periodAmount = computeCurrentDebt(
                amountWithFee, 
                lien.rate, 
                lien.state.lastPayment, 
                lien.startTime + lien.tenor
            );
            amountOwed = computeCurrentDebt(
                periodAmount, 
                lien.defaultRate, 
                lien.startTime + lien.tenor, 
                block.timestamp
            );
        }

        else if (block.timestamp > lien.state.lastPayment + lien.period) {
            uint256 periodAmount = computeCurrentDebt(
                amountWithFee, 
                lien.rate, 
                lien.state.lastPayment, 
                lien.state.lastPayment + lien.period
            );
            amountOwed = computeCurrentDebt(
                periodAmount, 
                lien.defaultRate, 
                lien.state.lastPayment + lien.period, 
                block.timestamp
            );
        }

        // the debt is current
        else {
            amountOwed = computeCurrentDebt(
                amountWithFee, 
                lien.rate, 
                lien.state.lastPayment, 
                block.timestamp
            );
        }

        feeInterest = amountWithFee - lien.principal;
        lenderInterest = amountOwed - amountWithFee;
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
    ) public view returns (uint256) {
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
