// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "solmate/src/utils/SignedWadMath.sol";

library FixedInterest {
    int256 private constant _YEAR_WAD = 365 days * 1e18;
    uint256 private constant _LIQUIDATION_THRESHOLD = 100_000;
    uint256 private constant _BASIS_POINTS = 10_000;

    function computeInterestAndFees(
        uint256 startTime,
        uint256 installment,
        uint256 period,
        uint256 installments,
        uint256 rate,
        uint256 defaultRate,
        uint256 fee,
        uint256 principal
    )
        public 
        view 
        returns (
            uint256 pastInterest,
            uint256 pastFee,
            uint256 currentInterest,
            uint256 currentFee
        ) 
    {   
        uint256 paidThrough = startTime + (installment * period);
        uint256 tenor = period * installments;

        // if the loan is paid up to date, return no interest
        if (block.timestamp < paidThrough) return (0, 0, 0, 0);

        bool inDefault = (block.timestamp > paidThrough + period) ? true : false;
        bool pastTenor = (block.timestamp > startTime + tenor) ? true : false;

        if (inDefault) {
            pastInterest = computeCurrentDebt(principal, defaultRate, period) - principal;
            pastFee = computeCurrentDebt(principal, fee, period) - principal;
        }

        if (!pastTenor) {
            currentInterest = computeCurrentDebt(principal, rate, period) - principal;
            currentFee = computeCurrentDebt(principal, fee, period) - principal;
        }
    }

    /**
     * @dev Computes the current debt of a borrow given the last time it was touched and the last computed debt.
     * @param amount Principal in ETH
     * @param rate Interest rate (in bips)
     * @param period Period in seconds
     */
    function computeCurrentDebt(
        uint256 amount,
        uint256 rate,
        uint256 period
    ) public pure returns (uint256) {
        int256 yearsWad = wadDiv(int256(period) * 1e18, _YEAR_WAD);
        return amount + uint256(wadMul(int256(amount), wadMul(yearsWad, bipsToSignedWads(rate))));
    }

    /**
     * @dev Converts an integer bips value to a signed wad value.
     */
    function bipsToSignedWads(uint256 bips) public pure returns (int256) {
        return int256((bips * 1e18) / _BASIS_POINTS);
    }

    function computeNextInstallment(
        bool cureOnly,
        uint256 installment
    ) external pure returns (uint256) {
        return cureOnly ? installment : installment + 1;
    }
}
