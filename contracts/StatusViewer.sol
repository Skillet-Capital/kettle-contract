// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Lien, LienState, LienStatus, PaymentDeadline } from "./Structs.sol";
import { FixedInterest } from "./models/FixedInterest.sol";

contract StatusViewer {

    function payments(Lien memory lien) public view returns (
        uint256 balance,
        uint256 principal,
        uint256 pastInterest,
        uint256 pastFee,
        uint256 currentInterest,
        uint256 currentFee
    ) {
        principal = lien.state.principal;

        (
            pastInterest, 
            pastFee, 
            currentInterest,
            currentFee
        ) = FixedInterest.computeInterestAndFees(
            lien.startTime,
            lien.state.installment,
            lien.period,
            lien.installments,
            lien.rate,
            lien.defaultRate,
            lien.fee,
            principal
        );

        balance = principal + pastInterest + pastFee + currentInterest + currentFee;
    }

    function lienStatus(Lien memory lien) 
        public 
        view 
        returns (
            LienStatus status,
            uint256 balance,
            PaymentDeadline memory delinquent, 
            PaymentDeadline memory current
        ) 
    {
        (
            uint256 _balance,
            uint256 principal,
            uint256 pastInterest,
            uint256 pastFee,
            uint256 currentInterest,
            uint256 currentFee
        ) = payments(lien);

        balance = _balance;

        uint256 paidThrough = lien.startTime + (lien.state.installment * lien.period);
        uint256 endTime = lien.startTime + (lien.period * lien.installments);
        uint256 lastInstallmentStartTime = lien.startTime + (lien.period * (lien.installments - 1));

        delinquent = PaymentDeadline({
            periodStart: paidThrough,
            deadline: paidThrough + lien.period + lien.gracePeriod,
            principal: 0,
            interest: pastInterest,
            fee: pastFee
        });

        current = PaymentDeadline({
            periodStart: paidThrough,
            deadline: paidThrough + lien.period,
            principal: 0,
            interest: currentInterest,
            fee: currentFee
        });

        // set defaulted status
        status = LienStatus.CURRENT;
        if (block.timestamp > paidThrough + lien.period + lien.gracePeriod) {
            status = LienStatus.DEFAULTED;
            if (block.timestamp > endTime) {
                current.periodStart = 0;
                current.deadline = 0;
            } else {
                current.periodStart = paidThrough + lien.period;
                current.deadline = paidThrough + lien.period * 2;
            }
        }

        else if (block.timestamp > paidThrough + lien.period) {
            status = LienStatus.DELINQUENT;
            if (block.timestamp > endTime) {
                current.periodStart = 0;
                current.deadline = 0;
            } else {
                current.periodStart = paidThrough + lien.period;
                current.deadline = paidThrough + lien.period * 2;
            }
        } 
        
        else {
            delinquent.periodStart = 0;
            delinquent.deadline = 0;
        }

        // if loan is past endtime, delinquent owes principal
        if (block.timestamp > endTime) {
            delinquent.principal = principal;
        } 
        
        // if loan is past last installment start time, current owes principal
        else if (block.timestamp > lastInstallmentStartTime) {
            current.principal = principal;
        }
    }
}
